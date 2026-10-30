import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { Workbook } from '../core/model';
import { prepareUserFormula } from './formulaPreparation';
import { analyzeStoredFormula } from './storedFormulaAnalysis';
import { projectStoredFormula } from './storedFormulaProjection';
import { decodeStoredFormula, encodeStoredFormula } from './storedFormula';

const sheet = sheetDocument({ id: 'inputs-id', name: 'Inputs', rowCount: 2, columnCount: 2 });
const workbook = workbookWithSheets([sheet]);
const prepare = (text: string) => prepareUserFormula(text, workbook, sheet.id);
const reordered = { ...sheet, content: { ...sheet.content, columns: [...sheet.content.columns].reverse(), rows: [...sheet.content.rows].reverse() } };

function modeledWorkbook(name = 'Cost'): Workbook {
  return { ...workbook, documents: { [sheet.id]: { ...sheet, modelId: 'model', modelColumnBindings: { cost: sheet.content.columns[1] } } }, dataModels: { model: { id: 'model', name: 'Model', columns: [{ id: 'cost', name, kind: 'manual', type: 'float' }] } } };
}

describe('stored editable projection', () => {
  it('projects current names and positions with reversed range order and independent anchors', () => {
    const content = prepare('=@Inputs!$B[$2]:A[1]+@A[2]');
    const renamed = workbookWithSheets([{ ...reordered, name: 'New Inputs' }]);

    const projection = projectStoredFormula(content, renamed);

    expect(projection.text).toBe("=@'New Inputs'!$A[$1]:B[2]+@B[1]");
    expect(projection.formula.occurrences.map(({ endpoints }) => endpoints)).toEqual(decodeStoredFormula(content).occurrences.map(({ endpoints }) => endpoints));
    expect(projection.formula.occurrences.map(({ slots }) => slots.map(({ targetIds }) => targetIds))).toEqual(decodeStoredFormula(content).occurrences.map(({ slots }) => slots.map(({ targetIds }) => targetIds)));
    expect(analyzeStoredFormula(encodeStoredFormula(projection.formula), renamed).references.every(({ live }) => live)).toBe(true);
    expect(projectStoredFormula(encodeStoredFormula(projection.formula), renamed).text).toBe(projection.text);
  });

  it('preserves unknown and malformed text while projecting independently live axes', () => {
    const content = prepare('=@A[3]+@C[1]+@Missing!B[2]+@A[0]+@foo-1[bad]+3');

    const projection = projectStoredFormula(content, workbookWithSheets([reordered]));

    expect(projection.text).toBe('=@B[3]+@C[2]+@Missing!B[2]+@A[0]+@foo-1[bad]+3');
    expect(analyzeStoredFormula(encodeStoredFormula(projection.formula), workbookWithSheets([reordered])).references.map(({ live }) => live)).toEqual([false, false, false]);
  });

  it.each(['sheet', 'column', 'row'])('retains dead %s identities and editable spelling instead of rebinding to replacements', (kind) => {
    const content = prepare('=@Inputs!A[1]');
    const changed = structuredClone(sheet);
    if (kind === 'sheet') changed.id = 'replacement';
    if (kind === 'column') changed.content.columns[0] = 'replacement';
    if (kind === 'row') changed.content.rows[0] = 'replacement';
    const changedWorkbook = workbookWithSheets([changed]);

    const projection = projectStoredFormula(content, changedWorkbook, changed.id);
    const repeated = projectStoredFormula(encodeStoredFormula(projection.formula), changedWorkbook, changed.id);

    expect(projection.text).toBe('=@Inputs!A[1]');
    expect(projection.formula).toEqual(decodeStoredFormula(content));
    expect(repeated.analysis.references[0].live).toBe(false);
    expect(repeated.formula).toEqual(projection.formula);
  });

  it('does not adopt caller sheet context for unresolved unqualified references', () => {
    const content = prepareUserFormula('=@A[1]', workbook);

    const projection = projectStoredFormula(content, workbook, sheet.id);

    expect(projection.formula).toEqual(decodeStoredFormula(content));
    expect(projection.analysis.result).toMatchObject({ kind: 'formula', expression: { kind: 'invalid-reference' } });
  });

  it('maps quoted escaped Unicode names, changed lengths, guards, origins and endpoint IDs', () => {
    const original = modeledWorkbook("O'Brien 🧮");
    original.documents[sheet.id].name = "老'表";
    const content = prepareUserFormula("=@'老''表'!$'O''Brien 🧮'[$2]+@'老''表'!'O''Brien 🧮'[1]", original, sheet.id);
    const changed = modeledWorkbook("税'率 𝒙");
    changed.documents[sheet.id] = { ...changed.documents[sheet.id], name: 'Next', content: reordered.content };

    const projection = projectStoredFormula(content, changed);
    const projectedContent = encodeStoredFormula(projection.formula);

    expect(projection.text).toBe("=@Next!$'税''率 𝒙'[$1]+@Next!'税''率 𝒙'[2]");
    expect(projection.formula.occurrences.map(({ guard }) => projection.text.slice(guard.start, guard.end))).toEqual(["@Next!$'税''率 𝒙'[$1]", "@Next!'税''率 𝒙'[2]"]);
    expect(projection.formula.occurrences[1].origins.filter(({ slotId }) => slotId !== null).map(({ start, end, slotId }) => [slotId, projection.text.slice(start, end)])).toEqual([['sheet', 'Next'], ['c0', "税''率 𝒙"], ['r0', '2']]);
    expect(projection.mappings.map(({ occurrenceId, slotId, projected }) => [occurrenceId, slotId, projection.text.slice(projected.start, projected.end)])).toEqual([
      ['f0', 'sheet', 'Next'], ['f0', 'c0', "'税''率 𝒙'"], ['f0', 'r0', '1'],
      ['f1', 'sheet', 'Next'], ['f1', 'c0', "'税''率 𝒙'"], ['f1', 'r0', '2'],
    ]);
    expect(analyzeStoredFormula(projectedContent, changed).references.every(({ live }) => live)).toBe(true);
    expect(projectStoredFormula(projectedContent, changed).formula).toEqual(projection.formula);
    expect(decodeStoredFormula(content).text).toBe("=@'老''表'!$'O''Brien 🧮'[$2]+@'老''表'!'O''Brien 🧮'[1]");
  });

  it('inserts brackets around a moved implicit property row and maps its zero-width marker', () => {
    const original = modeledWorkbook();
    const content = prepareUserFormula('=@Cost+@Cost[2]', original, sheet.id);
    const changed = modeledWorkbook('New Cost');
    changed.documents[sheet.id].content = reordered.content;

    const projection = projectStoredFormula(content, changed);

    expect(projection.text).toBe("=@'New Cost'[2]+@'New Cost'[1]");
    expect(projection.formula.occurrences[0].origins.filter(({ slotId }) => slotId === 'r0').map(({ start, end }) => projection.text.slice(start, end))).toEqual(['2']);
    expect(analyzeStoredFormula(encodeStoredFormula(projection.formula), changed).references.every(({ live }) => live)).toBe(true);
    expect(projectStoredFormula(encodeStoredFormula(projection.formula), changed).text).toBe(projection.text);
  });

  it('keeps an unmoved implicit row marker through a changed-length property rename', () => {
    const content = prepareUserFormula('=@Cost', modeledWorkbook(), sheet.id);

    const projection = projectStoredFormula(content, modeledWorkbook('Longer'));

    expect(projection.text).toBe('=@Longer');
    expect(projection.formula.occurrences[0].origins.find(({ slotId }) => slotId === 'r0')).toMatchObject({ start: 8, end: 8 });
    expect(analyzeStoredFormula(encodeStoredFormula(projection.formula), modeledWorkbook('Longer')).references[0].live).toBe(true);
  });

  it('projects a live property name and row independently when the other retained axis is dead', () => {
    const original = modeledWorkbook();
    const content = prepareUserFormula("=@'Cost'[1]+@'Cost'[2]", original, sheet.id);
    const changed = modeledWorkbook('Renamed');
    changed.documents[sheet.id].content = { ...reordered.content, rows: [sheet.content.rows[1], 'replacement'] };

    const projection = projectStoredFormula(content, changed);

    expect(projection.text).toBe('=@Renamed[1]+@Renamed[1]');
    expect(projection.analysis.references.map(({ live }) => live)).toEqual([false, true]);
    const reopened = analyzeStoredFormula(encodeStoredFormula(projection.formula), changed);
    expect(reopened.references.map(({ live }) => live)).toEqual([false, true]);
    expect(reopened.references[0].reference?.coordinate.rowId).toBe(sheet.content.rows[0]);
    expect(reopened.references[1].reference?.coordinate.rowId).toBe(sheet.content.rows[1]);
  });

  it.each(['=@foo-1[bad]+3', '=~F1["=@Inputs!A[1]",[]]'])('leaves literal internal-looking text intact: %s', (text) => {
    const content = prepare(text);

    const projection = projectStoredFormula(content, workbookWithSheets([reordered]));

    expect(projection.text).toBe(text);
    expect(projection.formula.occurrences).toEqual([]);
    expect(projection.mappings).toEqual([]);
  });

  it.each(['missing-model', 'missing-binding', 'replaced-property', 'replaced-column'])('keeps dead property pairs protected after %s', (scenario) => {
    const content = prepareUserFormula('=@Cost[1]', modeledWorkbook(), sheet.id);
    const changed = modeledWorkbook();
    if (scenario === 'missing-model') delete changed.dataModels;
    if (scenario === 'missing-binding') delete changed.documents[sheet.id].modelColumnBindings;
    if (scenario === 'replaced-property') changed.dataModels!.model.columns[0].id = 'replacement';
    if (scenario === 'replaced-column') changed.documents[sheet.id].content = { ...sheet.content, columns: [sheet.content.columns[0], 'replacement'] };

    const projection = projectStoredFormula(content, changed);

    expect(projection.text).toBe('=@Cost[1]');
    expect(projection.analysis.references[0].slots.find(({ slot }) => slot.kind === 'property')?.live).toBe(false);
    expect(projection.formula).toEqual(decodeStoredFormula(content));
  });

  it('maps dormant guards and markers through preceding projection edits without rebinding them', () => {
    const formula = decodeStoredFormula(prepare('=@Inputs!A[1]+@Inputs!B[2]'));
    formula.text = formula.text.slice(0, 20) + '?' + formula.text.slice(21);
    const content = encodeStoredFormula(formula);
    const changed = workbookWithSheets([{ ...reordered, name: "Long ' Name" }]);

    const projection = projectStoredFormula(content, changed);

    expect(projection.analysis.dormantOccurrences.map(({ id }) => id)).toEqual(['f1']);
    expect(projection.formula.occurrences[1].slots).toEqual(formula.occurrences[1].slots);
    expect(projection.text.slice(projection.formula.occurrences[1].guard.start)).toBe(formula.text.slice(formula.occurrences[1].guard.start));
    expect(analyzeStoredFormula(encodeStoredFormula(projection.formula), changed).dormantOccurrences.map(({ id }) => id)).toEqual(['f1']);
    expect(projectStoredFormula(content, changed)).toEqual(projection);
  });

  it('does not project a complete candidate whose persisted payload alignment is dormant', () => {
    const formula = decodeStoredFormula(prepare('=@A[1]'));
    formula.occurrences[0].slots[1].key = 1;
    const content = encodeStoredFormula(formula);

    const projection = projectStoredFormula(content, workbookWithSheets([reordered]));

    expect(projection.formula).toEqual(formula);
    expect(projection.analysis.dormantOccurrences).toHaveLength(1);
    expect(projection.mappings).toEqual([]);
  });

  it('shifts an adjacent dormant guard past an inserted implicit row suffix', () => {
    const original = modeledWorkbook();
    const formula = decodeStoredFormula(prepareUserFormula('=@Cost+@Cost[2]', original, sheet.id));
    const dormant = formula.occurrences[1];
    dormant.guard.start -= 1;
    dormant.origins.unshift({ start: dormant.guard.start, end: dormant.guard.start + 1, slotId: null });
    const marker = dormant.origins.find(({ slotId }) => slotId === 'sheet')!;
    marker.start = dormant.guard.start; marker.end = dormant.guard.start;
    dormant.origins.sort((left, right) => left.start - right.start || left.end - right.end);
    const changed = modeledWorkbook();
    changed.documents[sheet.id].content = reordered.content;

    const projection = projectStoredFormula(encodeStoredFormula(formula), changed);

    expect(projection.text).toBe('=@Cost[2]+@Cost[2]');
    expect(projection.formula.occurrences[0].guard.end).toBe(projection.formula.occurrences[1].guard.start);
    expect(projection.formula.occurrences[1].origins.find(({ slotId }) => slotId === 'sheet')?.start).toBe(projection.formula.occurrences[1].guard.start);
    expect(projection.text.slice(projection.formula.occurrences[1].guard.start)).toBe('+@Cost[2]');
    expect(analyzeStoredFormula(encodeStoredFormula(projection.formula), changed).dormantOccurrences.map(({ id }) => id)).toEqual(['f1']);
  });

  it('preserves codec ordering for coincident dormant markers with arbitrary slot IDs', () => {
    const formula = decodeStoredFormula(prepare('=@A[1]'));
    const occurrence = formula.occurrences[0];
    occurrence.slots.push(...['Z', 'a'].map((id) => ({ id, kind: 'row' as const, key: null, status: 'unresolved' as const, targetIds: [] })));
    occurrence.origins.unshift(...['Z', 'a'].map((slotId) => ({ start: occurrence.guard.start, end: occurrence.guard.start, slotId })));
    const content = encodeStoredFormula(formula);

    const projection = projectStoredFormula(content, workbook);

    expect(projection.formula).toEqual(formula);
    expect(encodeStoredFormula(projection.formula)).toBe(content);
  });
});
