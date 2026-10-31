import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import { instantiateStoredModelFormula } from '@workbook/formula/modelFormulaInstance';
import { changeEntryField, createModelEntryDraft } from '@application/core/modelEntryDraft';
import { applyBackendWorkbookReconciliation } from '@application/core/userActions';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { buildFormulaDependencyGraph, storedFormulaParser } from './formulaDependencies';
import { FormulaCalculation } from './formulaCalculation';

describe('open range calculation', () => {
  it('instantiates an anchored open range on model rows beyond the target extent', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 2, columnCount: 1, cells: { A1: '4', A2: '7' } });
    const output = sheetDocument({ id: 'output', name: 'Output', rowCount: 4, columnCount: 1 });
    const initial = workbookWithSheets([source, output]);
    const declaration = '=SUM(@Source!$A[$1]:A)';
    const template = prepareUserFormula(declaration, initial, output.id);
    const instance = instantiateStoredModelFormula(template, initial, 3, declaration, output.id);
    const target = sheetDocument({ id: output.id, name: output.name, rowCount: 4, columnCount: 1, cells: { A4: instance } });
    const workbook = workbookWithSheets([source, target]);

    expect(projectStoredFormula(instance, workbook, output.id).text).toBe(declaration);
    expect(new FormulaCalculation().updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).output.A4).toMatchObject({ value: 11 });
  });

  it('retains an open end, includes both columns and recalculates appended rows', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 2, columnCount: 2, cells: { A1: '1', B1: '2', A2: '3', B2: '4' } });
    const output = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1 });
    const formula = prepareUserFormula('=SUM(@Source!A[2]:B)', workbookWithSheets([source, output]), output.id);
    const target = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1, cells: { A1: formula } });
    const workbook = workbookWithSheets([source, target]);
    expect(projectStoredFormula(formula, workbook, output.id).text).toBe('=SUM(@Source!A[2]:B)');
    const calculation = new FormulaCalculation();
    expect(calculation.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).output.A1).toMatchObject({ value: 7 });
    const appended = applyBackendWorkbookReconciliation(workbook, { kind: 'append-row', sheetId: source.id, rowId: 'new-row' });
    expect(appended.ok).toBe(true);
    if (!appended.ok) throw new Error('Row append failed');
    expect(appended.value.calculationImpact).toEqual({ kind: 'structure' });
    const extended = { ...appended.value.nextWorkbook.documents.source, content: { ...appended.value.nextWorkbook.documents.source.content, cells: { ...source.content.cells, [cellIdentityKey({ rowId: 'new-row', columnId: source.content.columns[1] })]: '5' } } };
    const updated = workbookWithSheets([extended, target]);
    expect([...buildFormulaDependencyGraph(calculationProjection(updated), storedFormulaParser(updated)).dependencies.values()][0].size).toBe(4);
    expect(calculation.updateStored(calculationProjection(updated), updated, { kind: 'structure' }).output.A1).toMatchObject({ value: 12 });
    const edited = workbookWithSheets([{ ...extended, content: { ...extended.content, cells: { ...extended.content.cells, [cellIdentityKey({ rowId: 'new-row', columnId: source.content.columns[1] })]: '8' } } }, target]);
    expect(calculation.updateStored(calculationProjection(edited), edited, { kind: 'cells', cells: [{ sheetId: source.id, key: 'B3' }] }).output.A1).toMatchObject({ value: 15 });
  });

  it.each(['=SUM(@Source!A[3]:A)', '=SUM(@Source!A[1]:C)', '=SUM(@Missing!A[1]:A)'])('preserves and rejects missing targets in %s', (raw) => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 2, columnCount: 2 });
    const output = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1 });
    const formula = prepareUserFormula(raw, workbookWithSheets([source, output]), output.id);
    const target = sheetDocument({ id: output.id, name: output.name, rowCount: 1, columnCount: 1, cells: { A1: formula } });
    const workbook = workbookWithSheets([source, target]);
    expect(projectStoredFormula(formula, workbook, output.id).text).toBe(raw);
    expect(new FormulaCalculation().updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).output.A1).toMatchObject({ display: '#REF!' });
  });

  it('excludes a model entry draft and includes it only after row admission', () => {
    const source = { ...sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '4' } }), modelId: 'model', modelColumnBindings: { amount: 'source:column:1' } };
    const model = { id: 'model', name: 'Model', columns: [{ id: 'amount', name: 'Amount', kind: 'manual' as const, type: 'float' as const }] };
    const output = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1 });
    const initial = { ...workbookWithSheets([source, output]), dataModels: { model } };
    const formula = prepareUserFormula('=SUM(@Source!Amount[1]:Amount)', initial, output.id);
    const target = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1, cells: { A1: formula } });
    const workbook = { ...workbookWithSheets([source, target]), dataModels: { model } };
    const draft = changeEntryField(createModelEntryDraft(model), model, 'amount', '7', workbook, source.id);
    const calculation = new FormulaCalculation();
    expect(calculation.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).output.A1).toMatchObject({ value: 4 });
    const appended = applyBackendWorkbookReconciliation(workbook, { kind: 'append-row', sheetId: source.id, rowId: 'admitted' });
    if (!appended.ok) throw new Error('Row append failed');
    const admitted = appended.value.nextWorkbook.documents.source;
    const updated = { ...appended.value.nextWorkbook, documents: { ...appended.value.nextWorkbook.documents, source: { ...admitted, content: { ...admitted.content, cells: { ...admitted.content.cells, [cellIdentityKey({ rowId: 'admitted', columnId: source.content.columns[0] })]: draft.fields.amount.raw } } } } };
    expect(calculation.updateStored(calculationProjection(updated), updated, appended.value.calculationImpact).output.A1).toMatchObject({ value: 11 });
  });

});
