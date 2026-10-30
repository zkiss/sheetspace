import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { Workbook } from '../core/model';
import { prepareUserFormula } from './formulaPreparation';
import { projectStoredFormula } from './storedFormulaProjection';

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
    const projection = projectStoredFormula(content, renamed, sheet.id);
    expect(projection.text).toBe("=@'New Inputs'!$A[$1]:B[2]+@B[1]");
    expect(projection.analysis.references.every(({ live }) => live)).toBe(true);
    expect(projectStoredFormula(content, renamed, sheet.id).text).toBe(projection.text);
  });

  it('leaves unresolved references and malformed text unchanged after structural changes', () => {
    const text = '=@A[3]+@C[1]+@Missing!B[2]+@A[0]+@foo-1[bad]+3';
    const content = prepare(text);
    const projection = projectStoredFormula(content, workbookWithSheets([reordered]), sheet.id);
    expect(projection.text).toBe(text);
    expect(projection.analysis.references).toHaveLength(0);
  });

  it.each(['sheet', 'column', 'row'])('does not rebind a deleted %s identity to a replacement', (kind) => {
    const content = prepare('=@Inputs!A[1]');
    const changed = structuredClone(sheet);
    if (kind === 'sheet') changed.id = 'replacement';
    if (kind === 'column') changed.content.columns[0] = 'replacement';
    if (kind === 'row') changed.content.rows[0] = 'replacement';
    const projection = projectStoredFormula(content, workbookWithSheets([changed]), changed.id);
    expect(projection.analysis.references[0].live).toBe(false);
    expect(projectStoredFormula(content, workbookWithSheets([changed]), changed.id).analysis.references[0].live).toBe(false);
  });

  it('does not adopt caller sheet context for unresolved unqualified references', () => {
    const content = prepareUserFormula('=@A[1]', workbook);
    const projection = projectStoredFormula(content, workbook, sheet.id);
    expect(projection.text).toBe('=@A[1]');
    expect(projection.analysis.result).toMatchObject({ kind: 'formula', expression: { kind: 'invalid-reference' } });
  });

  it('projects quoted Unicode names and row positions after rename', () => {
    const original = modeledWorkbook("O'Brien 🧮");
    original.documents[sheet.id].name = "老'表";
    const content = prepareUserFormula("=@'老''表'!$'O''Brien 🧮'[$2]+@'老''表'!'O''Brien 🧮'[1]", original, sheet.id);
    const changed = modeledWorkbook("税'率 𝒙");
    changed.documents[sheet.id] = { ...changed.documents[sheet.id], name: 'Next', content: reordered.content };
    const projection = projectStoredFormula(content, changed, sheet.id);
    expect(projection.text).toBe("=@Next!$'税''率 𝒙'[$1]+@Next!'税''率 𝒙'[2]");
    expect(projection.analysis.references.every(({ live }) => live)).toBe(true);
  });

  it('projects implicit property rows after reorder and rename', () => {
    const content = prepareUserFormula('=@Cost+@Cost[2]', modeledWorkbook(), sheet.id);
    const changed = modeledWorkbook('New Cost');
    changed.documents[sheet.id].content = reordered.content;
    const projection = projectStoredFormula(content, changed, sheet.id);
    expect(projection.text).toBe("=@'New Cost'[2]+@'New Cost'[1]");
    expect(projection.analysis.references.every(({ live }) => live)).toBe(true);
  });

  it.each(['=@foo-1[bad]+3', '=~F1["=@Inputs!A[1]",[]]'])('leaves literal internal-looking text intact: %s', (text) => {
    const projection = projectStoredFormula(prepare(text), workbookWithSheets([reordered]), sheet.id);
    expect(projection.text).toBe(text);
    expect(projection.analysis.references).toHaveLength(0);
  });

  it.each(['missing-model', 'missing-binding', 'replaced-property', 'replaced-column'])('does not rebind dead properties after %s', (scenario) => {
    const content = prepareUserFormula('=@Cost[1]', modeledWorkbook(), sheet.id);
    const changed = modeledWorkbook();
    if (scenario === 'missing-model') delete changed.dataModels;
    if (scenario === 'missing-binding') delete changed.documents[sheet.id].modelColumnBindings;
    if (scenario === 'replaced-property') changed.dataModels!.model.columns[0].id = 'replacement';
    if (scenario === 'replaced-column') changed.documents[sheet.id].content = { ...sheet.content, columns: [sheet.content.columns[0], 'replacement'] };
    expect(projectStoredFormula(content, changed, sheet.id).analysis.references[0].live).toBe(false);
  });
});
