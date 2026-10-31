import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { addDataModel, setSheetModelId } from '@workbook/mutations/dataModel';
import { parseUserFormulaSyntax } from './syntax';
import { prepareUserFormula } from './formulaPreparation';
import { cellIdentityAt } from '../core/cellIdentity';
import { copyStoredFormula } from './storedFormulaCopy';
import { moveStoredFormula } from './storedFormulaMove';
import { projectStoredFormula } from './storedFormulaProjection';

function modelWorkbook() {
  const initial = workbookWithSheets([sheetDocument({ id: 'sheet', name: 'Budget', rowCount: 3, columnCount: 2 })]);
  const model = addDataModel(initial, { id: 'model', name: 'Model', columns: [
    { id: 'revenue', name: 'Total Revenue', kind: 'manual', type: 'float' },
    { id: 'profit', name: 'Profit', kind: 'manual', type: 'float' },
  ] });
  if (!model.ok) throw new Error(model.reason);
  const bound = setSheetModelId(model.value, 'sheet', 'model');
  if (!bound.ok) throw new Error(bound.reason);
  return bound.value;
}

describe('open reference syntax and storage', () => {
  it.each(['=@A[2]:B', "=@Budget!'Total Revenue'[2]:Profit", '=@Budget!$A[$2]:$B'])('recognizes the whole range in %s', (text) => {
    const syntax = parseUserFormulaSyntax(text, (_sheet, name) => name === 'Total Revenue' || name === 'Profit');
    expect(syntax.result.kind).toBe('formula');
    expect(syntax.referenceLexemes[0].sourceSpan).toEqual({ start: 1, end: text.length });
    expect(syntax.referenceLexemes[0].endpoints[1].open).toBe(true);
  });

  it('stores stable named columns and keeps the ending row open after a sheet rename', () => {
    const workbook = modelWorkbook();
    const raw = "=SUM(@Budget!'Total Revenue'[2]:Profit)";
    const stored = prepareUserFormula(raw, workbook, 'sheet');
    expect(projectStoredFormula(stored, workbook, 'sheet').text).toBe(raw);
    const renamed = { ...workbook, documents: { ...workbook.documents, sheet: { ...workbook.documents.sheet, name: 'Renamed' } } };
    expect(projectStoredFormula(stored, renamed, 'sheet').text).toBe("=SUM(@Renamed!'Total Revenue'[2]:Profit)");
  });

  it('copies anchored starts without freezing or shifting the open row', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 4, columnCount: 4 });
    const workbook = workbookWithSheets([sheet]);
    const stored = prepareUserFormula('=SUM(@$A[$4]:B)', workbook, 'sheet');
    const copy = copyStoredFormula(stored, cellIdentityAt(sheet.content, 'A1')!, cellIdentityAt(sheet.content, 'B2')!, workbook, { sourceSheetId: 'sheet', destinationSheetId: 'sheet' });
    expect(copy.ok).toBe(true);
    if (copy.ok) expect(projectStoredFormula(copy.content, workbook, 'sheet').text).toBe('=SUM(@$A[$4]:C)');
  });

  it('rejects a partial move inside an open range rather than freezing its extent', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 4, columnCount: 3 });
    const workbook = workbookWithSheets([sheet]);
    const stored = prepareUserFormula('=SUM(@A[1]:B)', workbook, 'sheet');
    const moved = moveStoredFormula(stored, workbook, 'sheet', 'sheet', [{
      source: { sheetId: 'sheet', cell: cellIdentityAt(sheet.content, 'A3')! },
      destination: { sheetId: 'sheet', cell: cellIdentityAt(sheet.content, 'C3')! },
    }]);
    expect(moved).toEqual({ ok: false, reason: 'unrepresentable-range' });
  });

  it('tracks a renamed property identity and rejects its removal', () => {
    const workbook = modelWorkbook();
    const stored = prepareUserFormula("=SUM(@'Total Revenue'[2]:Profit)", workbook, 'sheet');
    const model = workbook.dataModels!.model;
    const renamed = { ...workbook, dataModels: { ...workbook.dataModels, model: { ...model, columns: model.columns.map((column) => column.id === 'profit' ? { ...column, name: 'Net Profit' } : column) } } };
    expect(projectStoredFormula(stored, renamed, 'sheet').text).toBe("=SUM(@'Total Revenue'[2]:'Net Profit')");
    const removed = { ...renamed, dataModels: { ...renamed.dataModels, model: { ...renamed.dataModels.model, columns: renamed.dataModels.model.columns.slice(0, 1) } } };
    expect(projectStoredFormula(stored, removed, 'sheet').text).toBe('=SUM(#REF!)');
  });

});
