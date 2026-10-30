import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { prepareModelFormula, prepareModelFormulas, instantiatePreparedModelFormula } from './preparedModelTemplate';
import { projectStoredFormula } from './storedFormulaProjection';

const sheet = sheetDocument({ id: 'sheet', name: 'Inputs', rowCount: 3, columnCount: 2 });
const workbook = workbookWithSheets([sheet]);

describe('stored model formula instantiation', () => {
  it('transports only inline content and instantiates relative and anchored row recipes', () => {
    const declaration = '=@A[1]:$B[$2]+???';
    const template = prepareModelFormula(declaration, workbook, sheet.id);
    const transported = JSON.parse(JSON.stringify(template));
    const instance = instantiatePreparedModelFormula(transported, workbook, 1, declaration, sheet.id);

    expect(Object.keys(transported)).toEqual(['content']);
    expect(projectStoredFormula(instance, workbook, sheet.id).text).toBe('=@A[2]:$B[$2]+???');
    expect(projectStoredFormula(template.content, workbook, sheet.id).text).toBe(declaration);
  });

  it('prepares an empty-sheet template and resolves its row recipe after append', () => {
    const declaration = '=@A[1]:$B[$2]';
    const empty = { ...sheet, content: { ...sheet.content, rows: [], cells: {} } };
    const template = prepareModelFormula(declaration, workbookWithSheets([empty]), sheet.id);
    const instance = instantiatePreparedModelFormula(template, workbook, 1, declaration, sheet.id);

    expect(projectStoredFormula(instance, workbook, sheet.id).text).toBe('=@A[2]:$B[$2]');
  });

  it('prepares only calculated declarations and preserves unresolved fragments', () => {
    const bound = { ...sheet, modelId: 'model', modelColumnBindings: { input: sheet.content.columns[0], output: sheet.content.columns[1] } };
    const modeled = { ...workbookWithSheets([bound]), dataModels: { model: { id: 'model', name: 'Model', columns: [
      { id: 'input', name: 'Input', kind: 'manual' as const, type: 'float' as const },
      { id: 'output', name: 'Output', kind: 'calculated' as const, type: 'float' as const, formula: '=@Input*2+@Missing[1]' },
    ] } } };
    const templates = prepareModelFormulas(modeled, sheet.id);

    expect(Object.keys(templates)).toEqual(['output']);
    expect(projectStoredFormula(templates.output.content, modeled, sheet.id).text).toBe('=@Input[1]*2+@Missing[1]');
    expect(prepareModelFormulas(modeled, 'unknown')).toEqual({});
    expect(prepareModelFormulas(workbook, sheet.id)).toEqual({});
    expect(prepareModelFormulas({ ...modeled, dataModels: {} }, sheet.id)).toEqual({});
    expect(prepareModelFormulas(workbookWithSheets([bound]), sheet.id)).toEqual({});
  });

  it('preserves unresolved text when a target row is unavailable', () => {
    const declaration = '=@A[3]+@Missing!A[1]';
    const template = prepareModelFormula(declaration, workbook, sheet.id);
    const instance = instantiatePreparedModelFormula(template, workbook, 1, declaration, sheet.id);

    expect(projectStoredFormula(instance, workbook, sheet.id).text).toBe(declaration);
  });

  it('does not bind a deleted target to a replacement with the same name', () => {
    const declaration = '=@Inputs!A[1]';
    const template = prepareModelFormula(declaration, workbook, sheet.id);
    const replacement = sheetDocument({ id: 'replacement', name: 'Inputs', rowCount: 1, columnCount: 1 });
    const changed = workbookWithSheets([replacement]);
    const instance = instantiatePreparedModelFormula(template, changed, 0, declaration, sheet.id);

    expect(instance).toBe(template.content);
  });
});
