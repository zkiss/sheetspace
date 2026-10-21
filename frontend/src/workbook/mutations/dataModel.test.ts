import { describe, expect, it } from 'vitest';
import type { DataModel, Workbook } from '../core/model';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { addDataModel, replaceDataModel, setSheetModelId, validateDataModel, type ModelMutationResult } from './dataModel';
import { formulaRawToCanonical, formulaRawToDisplay, workbookFormulaReferenceResolver } from '../formula/reference';

const model: DataModel = {
  id: 'budget', name: 'Budget', columns: [
    { id: 'revenue', name: 'Revenue', kind: 'manual', type: 'float' },
    { id: 'cost', name: 'Cost', kind: 'manual', type: 'float' },
    { id: 'extra', name: 'Extra', kind: 'manual', type: 'string' },
  ],
};
const calculatedModel: DataModel = {
  ...model,
  columns: [model.columns[0]!, { id: 'cost', name: 'Cost', kind: 'calculated', type: 'float', formula: '=unfinished(' }],
};
const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', columnCount: 2, rowCount: 2, cells: { A1: '12' } });
const otherSheet = sheetDocument({ id: 'other', name: 'Other', columnCount: 1, rowCount: 0 });
const workbook: Workbook = { ...workbookWithSheets([sheet, otherSheet]), dataModels: { [model.id]: model } };

function successful(result: ModelMutationResult): Workbook {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe('property identity associations', () => {
  it('attaches existing columns in declaration order without reshaping or evaluating formulas', () => {
    const bound = successful(setSheetModelId(workbook, sheet.id, model.id));

    expect(bound.documents[sheet.id]).toEqual({ ...sheet, modelId: model.id, modelColumnBindings: {
      revenue: sheet.content.columns[0], cost: sheet.content.columns[1],
    } });
    expect(bound.documents[sheet.id]!.content).toBe(sheet.content);
    expect(bound.documents[sheet.id]!.presentation).toBe(sheet.presentation);
    expect(bound.documents[otherSheet.id]).toBe(otherSheet);
    expect(sheet.modelColumnBindings).toBeUndefined();
    expect(formulaRawToDisplay(formulaRawToCanonical("=@'Revenue'[1]", workbookFormulaReferenceResolver(bound, sheet.id)),
      workbookFormulaReferenceResolver(bound, sheet.id))).toBe("=@'Revenue'[1]");
  });

  it('keeps retained property targets across rename and reorder', () => {
    const bound = successful(setSheetModelId(workbook, sheet.id, model.id));
    const canonical = formulaRawToCanonical("=@'Revenue'[1]", workbookFormulaReferenceResolver(bound, sheet.id));
    const edited = successful(replaceDataModel(bound, { ...model, columns: [model.columns[1]!, { ...model.columns[0]!, name: 'Net Revenue' }] }));

    expect(edited.documents[sheet.id]!.modelColumnBindings).toEqual(bound.documents[sheet.id]!.modelColumnBindings);
    expect(formulaRawToDisplay(canonical, workbookFormulaReferenceResolver(edited, sheet.id))).toBe("=@'Net Revenue'[1]");
  });

  it('recomputes the default mapping when the same model is attached again', () => {
    const bound = successful(setSheetModelId(workbook, sheet.id, model.id));
    const edited = successful(replaceDataModel(bound, { ...model, columns: [model.columns[1]!, { ...model.columns[0]!, name: 'Net Revenue' }] }));

    const reattached = successful(setSheetModelId(edited, sheet.id, model.id));

    expect(reattached).not.toBe(edited);
    expect(reattached.documents[sheet.id]!.modelColumnBindings).toEqual({
      cost: sheet.content.columns[0], revenue: sheet.content.columns[1],
    });
  });

  it('keeps a same-model request with an identical explicit mapping a no-op', () => {
    const bound = successful(setSheetModelId(workbook, sheet.id, model.id));

    const again = successful(setSheetModelId(bound, sheet.id, model.id, bound.documents[sheet.id]!.modelColumnBindings));

    expect(again).toBe(bound);
    expect(again.documents[sheet.id]!.modelFormulaBindings).toBeUndefined();
  });

  it('applies an explicit mapping instead of the default one', () => {
    const bound = successful(setSheetModelId(workbook, sheet.id, model.id, { revenue: sheet.content.columns[1], cost: sheet.content.columns[0] }));

    expect(bound.documents[sheet.id]!.modelColumnBindings).toEqual({
      revenue: sheet.content.columns[1], cost: sheet.content.columns[0],
    });
  });

  it('drops removed properties without reviving references when names are reused', () => {
    const bound = successful(setSheetModelId(workbook, sheet.id, model.id));
    const canonical = formulaRawToCanonical("=@'Revenue'[1]", workbookFormulaReferenceResolver(bound, sheet.id));
    const edited = successful(replaceDataModel(bound, { ...model, columns: [
      { ...model.columns[0]!, id: 'fresh-revenue' }, model.columns[1]!,
    ] }));

    expect(edited.documents[sheet.id]!.modelColumnBindings).toEqual({ cost: sheet.content.columns[1] });
    expect(formulaRawToDisplay(canonical, workbookFormulaReferenceResolver(edited, sheet.id))).toBe('=#REF!');
    expect(formulaRawToCanonical("=@'Revenue'[1]", workbookFormulaReferenceResolver(edited, sheet.id))).toBe('=#REF!');
  });

  it('clears associations on unbind and establishes fresh associations for a different model', () => {
    const bound = successful(setSheetModelId(workbook, sheet.id, model.id));
    const unbound = successful(setSheetModelId(bound, sheet.id));
    const second = { ...model, id: 'second', columns: [model.columns[1]!] };
    const switched = successful(setSheetModelId(successful(addDataModel(bound, second)), sheet.id, second.id));

    expect(unbound.documents[sheet.id]!.modelColumnBindings).toBeUndefined();
    expect(unbound.documents[sheet.id]!.modelId).toBeUndefined();
    expect(switched.documents[sheet.id]!.modelColumnBindings).toEqual({ cost: sheet.content.columns[0] });
    expect(successful(setSheetModelId(workbook, sheet.id))).toBe(workbook);
  });

  it('does not reshape zero-column sheets or add associations during declaration edits', () => {
    const empty = { ...sheet, content: { ...sheet.content, columns: [], cells: {} } };
    const emptyWorkbook = { ...workbook, documents: { ...workbook.documents, [sheet.id]: empty } };
    const bound = successful(setSheetModelId(emptyWorkbook, sheet.id, model.id));
    const metadataOnly = { ...workbook, documents: { ...workbook.documents, [sheet.id]: { ...sheet, modelId: model.id } } };

    expect(bound.documents[sheet.id]!.modelColumnBindings).toEqual({});
    expect(successful(replaceDataModel(metadataOnly, model)).documents[sheet.id]!.modelColumnBindings).toBeUndefined();
  });

  it('rejects a model that declares a calculated property and an invalid explicit mapping', () => {
    const withCalculated = { ...workbook, dataModels: { [calculatedModel.id]: calculatedModel } };

    expect(setSheetModelId(withCalculated, sheet.id, calculatedModel.id)).toEqual({ ok: false, reason: 'invalid-model' });
    expect(setSheetModelId(workbook, sheet.id, model.id, { revenue: 'missing-column' })).toEqual({ ok: false, reason: 'invalid-model' });
    expect(setSheetModelId(workbook, sheet.id, model.id, { unknown: sheet.content.columns[0]! })).toEqual({ ok: false, reason: 'invalid-model' });
  });

  it('rejects unknown models and sheets without changing the workbook', () => {
    expect(setSheetModelId(workbook, 'missing', model.id)).toEqual({ ok: false, reason: 'unknown-sheet' });
    expect(setSheetModelId(workbook, sheet.id, 'missing')).toEqual({ ok: false, reason: 'unknown-model' });
    expect(setSheetModelId({ ...workbook, dataModels: undefined }, sheet.id, model.id)).toEqual({ ok: false, reason: 'unknown-model' });
    expect(replaceDataModel(workbook, { ...model, id: 'missing' })).toEqual({ ok: false, reason: 'unknown-model' });
    expect(replaceDataModel({ ...workbook, dataModels: undefined }, model)).toEqual({ ok: false, reason: 'unknown-model' });
  });
});

describe('declaration mutations', () => {
  it('adds valid declarations and rejects duplicate models', () => {
    expect(successful(addDataModel({ ...workbook, dataModels: undefined }, model)).dataModels).toEqual({ [model.id]: model });
    expect(addDataModel(workbook, model)).toEqual({ ok: false, reason: 'duplicate-model' });
    expect(validateDataModel({ ...model, columns: [] })).toBeUndefined();
  });

  it.each([
    { ...model, id: '' }, { ...model, name: ' ' },
    { ...model, columns: [{ ...model.columns[0]!, id: ' ' }] },
    { ...model, columns: [{ ...model.columns[0]!, name: '' }] },
    { ...model, columns: [model.columns[0]!, { ...model.columns[1]!, id: model.columns[0]!.id }] },
    { ...model, columns: [model.columns[0]!, { ...model.columns[1]!, name: ` ${model.columns[0]!.name} ` }] },
    { ...model, columns: [{ ...model.columns[1]!, formula: ' ' }] } as unknown as DataModel,
    { ...model, columns: [{ ...model.columns[0]!, formula: '=1' }] } as unknown as DataModel,
    { ...model, columns: [{ ...model.columns[0]!, type: 'decimal' }] } as unknown as DataModel,
  ])('rejects invalid metadata without changing bound sheets: %j', (invalid) => {
    expect(validateDataModel(invalid)).toEqual({ ok: false, reason: 'invalid-model' });
    expect(addDataModel({ ...workbook, dataModels: undefined }, invalid)).toEqual({ ok: false, reason: 'invalid-model' });
    expect(replaceDataModel(workbook, invalid.id === model.id ? invalid : { ...invalid, id: model.id, name: '' })).toEqual({ ok: false, reason: 'invalid-model' });
  });
});
