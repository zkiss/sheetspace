import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { prepareFormulaEdit, prepareUserFormula, prepareModelFormulaContent } from './formulaPreparation';
import { projectStoredFormula } from './storedFormulaProjection';
import { analyzeStoredFormula } from './storedFormulaAnalysis';
import { escapeFormulaText, opaqueFormulaText } from './opaqueFormulaText';
import { requireStoredFormula } from './storedFormula';
import { copyStoredFormula } from './storedFormulaCopy';
import { moveStoredFormula } from './storedFormulaMove';
import { instantiateStoredModelFormula } from './modelFormulaInstance';
import { modelFormulaAssociations, modelFormulaRecipes } from './modelFormulaAssociation';
import { applyFormulaNameEdits, projectOpaqueModelTemplate } from './renamedModelFormulas';

const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 3, columnCount: 3 });
const workbook = workbookWithSheets([sheet]);
const display = (content: string) => projectStoredFormula(content, workbook, sheet.id).text;

describe('inline authoritative formula content', () => {
  it('binds independently of malformed text and round trips through transport and projection', () => {
    const text = '=SUM(@Inputs!A[1], @Missing!B[2], ???)';
    const content = prepareUserFormula(text, workbook, sheet.id);
    const restored = requireStoredFormula(JSON.parse(JSON.stringify(content)));

    expect(content).toContain(`@inputs!${sheet.content.columns[0]}[${sheet.content.rows[0]}]`);
    expect(content).not.toContain('=~F1');
    expect(display(restored)).toBe(text);
    expect(analyzeStoredFormula(restored, workbook, sheet.id).references).toHaveLength(1);
    expect(analyzeStoredFormula(restored, workbook, sheet.id).result.kind).toBe('error');
  });

  it.each(['=~{0040}', '=@inputs:column:1[inputs:row:1]', '=RAW("@A[1]")', '="~{bad}"&???', '=\t@Missing!A[1]+???😀"\\\n', '=~{~{0040}}'])('preserves literal user text %s without granting canonical authority', (text) => {
    const content = prepareUserFormula(text, workbook, sheet.id);
    expect(display(content)).toBe(text);
    expect(analyzeStoredFormula(content, workbook, sheet.id).references).toHaveLength(0);
  });

  it('decodes opaque payloads once and validates malformed escapes outside literals', () => {
    const text = '~{0040}\ud800😀\u0000"';
    expect(opaqueFormulaText(`=${escapeFormulaText(text)}`)[0].text).toBe(text);
    expect(display(`=${escapeFormulaText(text)}`)).toBe(`=${text}`);
    for (const content of ['not a formula', '=~{}', '=~{004}', '=~{FFFF}', '=~{0040']) {
      expect(() => requireStoredFormula(content)).toThrow('Invalid stored formula');
    }
    expect(requireStoredFormula('="~{bad}"')).toBe('="~{bad}"');
  });

  it('rebinds formerly unresolved text only on explicit commit', () => {
    const content = prepareUserFormula('=@Missing!A[1]', workbook, sheet.id);
    const missing = sheetDocument({ id: 'now-present', name: 'Missing', rowCount: 1, columnCount: 1 });
    const current = workbookWithSheets([sheet, missing]);
    expect(analyzeStoredFormula(content, current, sheet.id).references).toHaveLength(0);
    expect(projectStoredFormula(content, current, sheet.id).text).toBe('=@Missing!A[1]');
    const committed = prepareFormulaEdit('=@Missing!A[1]', content, current, sheet.id);
    expect(committed).toContain('@now-present!');
    expect(analyzeStoredFormula(committed, current, sheet.id).references[0].live).toBe(true);
  });

  it('retains unchanged canonical tokens through rename and an ordinary surrounding edit', () => {
    const content = prepareUserFormula('=@Inputs!A[1]+2', workbook, sheet.id);
    const renamed = workbookWithSheets([{ ...sheet, name: 'Renamed' }]);
    const draft = projectStoredFormula(content, renamed, sheet.id).text.replace('+2', '+3');
    const committed = prepareFormulaEdit(draft, content, renamed, sheet.id);
    expect(committed).toBe(content.replace('+2', '+3'));
  });

  it('copies anchored inline ranges while leaving opaque bytes alone', () => {
    const content = prepareUserFormula('=SUM(@A[1]:$B[$2], @Missing!A[1])', workbook, sheet.id);
    const copied = copyStoredFormula(content, { columnId: sheet.content.columns[0], rowId: sheet.content.rows[0] }, { columnId: sheet.content.columns[1], rowId: sheet.content.rows[1] }, workbook, { sourceSheetId: sheet.id, destinationSheetId: sheet.id });
    expect(copied.ok && display(copied.content)).toBe('=SUM(@B[2]:$B[$2], @Missing!A[1])');
    expect(copied.ok && opaqueFormulaText(copied.content)[0].text).toBe('@Missing!A[1]');
    expect(moveStoredFormula(content, workbook, sheet.id)).toEqual({ ok: true, content });
  });

  it('derives row recipes from declarations even after current row positions change', () => {
    const declaration = '=@A[1]:$B[$2]+???';
    const template = prepareUserFormula(declaration, workbook, sheet.id);
    const reordered = workbookWithSheets([{ ...sheet, content: { ...sheet.content, rows: [...sheet.content.rows].reverse() } }]);
    const instance = instantiateStoredModelFormula(template, reordered, 1, declaration, sheet.id);
    expect(projectStoredFormula(instance, reordered, sheet.id).text).toBe('=@A[2]:$B[$2]+???');
    expect(modelFormulaRecipes(template, declaration)).toHaveLength(1);
    expect(modelFormulaRecipes(template, declaration.replace('+???', '*3'))).toBeUndefined();
    expect(modelFormulaRecipes(template, declaration.replace('$B', 'B'))).toBeUndefined();
  });

  it('keeps opaque model fragments unbound and falls back to raw text for unavailable rows', () => {
    const declaration = '=@A[3]+@Missing!A[1]';
    const template = prepareUserFormula(declaration, workbook, sheet.id);
    const instance = instantiateStoredModelFormula(template, workbook, 1, declaration, sheet.id);
    expect(display(instance)).toBe(declaration);
    expect(analyzeStoredFormula(instance, workbook, sheet.id).references).toHaveLength(0);
    expect(() => instantiateStoredModelFormula(template, workbook, 1, '=1', sheet.id)).toThrow();
  });

  it('associates canonical and opaque references without losing their source spans', () => {
    const declaration = '=@A[1]+@Missing!A[1]:B[2]+"@Missing!A[1]"';
    const template = prepareUserFormula(declaration, workbook, sheet.id);
    const associations = modelFormulaAssociations(template, declaration)!;

    expect(associations).toHaveLength(2);
    expect(associations[0].stored).toBeDefined();
    const span = associations[1].opaque!;
    expect(opaqueFormulaText(template.slice(span.start, span.end))[0].text).toBe('@Missing!A[1]:B[2]');
    expect(modelFormulaAssociations(template, declaration.replace('+"', '*"'))).toBeUndefined();
  });

  it('projects only edited opaque references while retaining canonical tokens and literals', () => {
    const declaration = '=@A[1]+@Missing!A[1]:B[2]+"A"';
    const template = prepareUserFormula(declaration, workbook, sheet.id);
    const start = declaration.indexOf('A[1]', declaration.indexOf('Missing'));
    const edits = [{ start, end: start + 1, text: "'New name'" }];

    const projected = projectOpaqueModelTemplate(template, declaration, edits);
    const next = applyFormulaNameEdits(declaration, edits);
    const oldAssociations = modelFormulaAssociations(template, declaration)!;
    const newAssociations = modelFormulaAssociations(projected, next)!;
    expect(projected.slice(newAssociations[0].stored!.sourceSpan.start, newAssociations[0].stored!.sourceSpan.end))
      .toBe(template.slice(oldAssociations[0].stored!.sourceSpan.start, oldAssociations[0].stored!.sourceSpan.end));
    expect(opaqueFormulaText(projected.slice(newAssociations[1].opaque!.start, newAssociations[1].opaque!.end))[0].text).toBe("@Missing!'New name'[1]:B[2]");
    expect(projected.endsWith('+"A"')).toBe(true);
    expect(() => projectOpaqueModelTemplate(template, '=1', edits)).toThrow('Invalid model formula association');
  });

  it('binds template columns before rows exist and instantiates only from the declaration recipe', () => {
    const empty = workbookWithSheets([{ ...sheet, content: { ...sheet.content, rows: [] } }]);
    const declaration = '=@A[1]+@Missing!A[1]';
    const template = prepareModelFormulaContent(declaration, empty, sheet.id);
    const instance = instantiateStoredModelFormula(template, workbook, 1, declaration, sheet.id);
    expect(display(instance)).toBe('=@A[2]+@Missing!A[1]');
  });
});
