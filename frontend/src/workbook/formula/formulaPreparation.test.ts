import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { Workbook } from '../core/model';
import { prepareUserFormula } from './formulaPreparation';
import { projectStoredFormula } from './storedFormulaProjection';
import { analyzeStoredFormula } from './storedFormulaAnalysis';

const sheet = sheetDocument({ id: 'inputs-id', name: 'Inputs', rowCount: 2, columnCount: 2 });
const workbook = workbookWithSheets([sheet]);
const display = (content: string, book = workbook) => projectStoredFormula(content, book, sheet.id).text;

function modeledWorkbook(): Workbook {
  return {
    ...workbook,
    documents: { [sheet.id]: { ...sheet, modelId: 'model', modelColumnBindings: { cost: sheet.content.columns[1] } } },
    dataModels: { model: { id: 'model', name: 'Model', columns: [{ id: 'cost', name: 'Cost', kind: 'manual', type: 'float' }] } },
  };
}

describe('fresh formula preparation', () => {
  it('binds complete references independently in invalid expressions', () => {
    const text = '=@Inputs!A[1]+@Missing!B[2]+@A[0]+???+@B[2]';
    const stored = prepareUserFormula(text, workbook, sheet.id);
    expect(display(stored)).toBe(text);
    expect(analyzeStoredFormula(stored, workbook, sheet.id).references).toHaveLength(2);
    expect(stored).toContain(sheet.content.rows[0]);
    expect(stored).toContain(sheet.content.rows[1]);
  });

  it('resolves explicit names without a current sheet, never sheet ID spelling', () => {
    const text = '=@Inputs!A[1]+@inputs-id!A[1]+@A[1]';
    const stored = prepareUserFormula(text, workbook);
    expect(display(stored)).toBe(text);
    expect(analyzeStoredFormula(stored, workbook, sheet.id).references).toHaveLength(1);
  });

  it('preserves references with an unavailable axis without binding them', () => {
    const text = '=@A[3]+@C[1]';
    const stored = prepareUserFormula(text, workbook, sheet.id);
    expect(display(stored)).toBe(text);
    expect(analyzeStoredFormula(stored, workbook, sheet.id).references).toHaveLength(0);
  });

  it('preserves range endpoint order and anchors', () => {
    const text = '=@Inputs!$B[$2]:A[1]';
    const stored = prepareUserFormula(text, workbook, sheet.id);
    expect(display(stored)).toBe(text);
    expect(stored).toContain(sheet.content.columns[1]);
    expect(stored).toContain(sheet.content.rows[0]);
  });

  it('binds known properties and preserves unavailable ones', () => {
    const book = modeledWorkbook();
    const text = "=@Cost[2]+@'Cost'[3]+@'Missing'[1]+@Cost";
    const stored = prepareUserFormula(text, book, sheet.id);
    expect(display(stored, book)).toBe(text.replace("+@Cost", "+@Cost[1]"));
    expect(analyzeStoredFormula(stored, book, sheet.id).references).toHaveLength(2);
  });

  it.each(['missing-model', 'missing-binding', 'deleted-column'])('does not bind a %s property', (scenario) => {
    const book = modeledWorkbook();
    const document = book.documents[sheet.id];
    if (scenario === 'missing-model') delete book.dataModels;
    if (scenario === 'missing-binding') delete document.modelColumnBindings;
    if (scenario === 'deleted-column') document.content = { ...document.content, columns: [] };
    const text = "=@'Cost'[1]";
    const stored = prepareUserFormula(text, book, sheet.id);
    expect(display(stored, book)).toBe(text.replace("+@Cost", "+@Cost[1]"));
    expect(analyzeStoredFormula(stored, book, sheet.id).references).toHaveLength(0);
  });

  it.each(['=@foo-1[bad]+3', '=~F1["=@Inputs!A[1]",[]]', '="@Inputs!A[1]"'])('preserves internal-looking or quoted input: %s', (text) => {
    const stored = prepareUserFormula(text, workbook, sheet.id);
    expect(display(stored)).toBe(text);
    expect(analyzeStoredFormula(stored, workbook, sheet.id).references).toHaveLength(0);
  });

  it('preserves unknown current-sheet references and rejects nonformula API misuse', () => {
    const stored = prepareUserFormula('=@A[1]', workbook, 'missing-sheet');
    expect(display(stored)).toBe('=@A[1]');
    expect(analyzeStoredFormula(stored, workbook, sheet.id).references).toHaveLength(0);
    expect(() => prepareUserFormula('text', workbook)).toThrow('Invalid stored formula');
  });
});
