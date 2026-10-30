import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindSheetToModel, replaceModelDeclaration, unbindSheetFromModel } from '@application/core/modelLifecycle';
import { applyWorkbookOperation, preparePasteCellWrites } from '@application/core/userActions';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { displayRawCellValue } from '@calculation/formulaValue';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { calculationProjection } from '@workbook/read/calculationProjection';
import type { DataModel, Workbook } from '@workbook/core/model';
import { decodeCellTextLiteral } from '@workbook/core/cellLiteral';
import { cellRawContent } from '@workbook/read/queries';
import type { ModelMutationResult } from '@workbook/mutations/dataModel';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { decodeWorkbookBundle, encodeWorkbookBundle, workbookApi } from './workbookApi';

function successful(result: ModelMutationResult): Workbook {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

afterEach(() => vi.unstubAllGlobals());

describe('lifecycle HTTP mapping', () => {
  it('retains an extra named ordinary column through binding, structural replacement and reload', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { B1: '42' } });
    const extra = sheet.content.columns[1];
    const model: DataModel = { id: 'model', name: 'Model', columns: [{ id: 'input', name: 'Input', kind: 'manual', type: 'float' }] };
    const initial = { ...workbookWithSheets([{ ...sheet, columnNames: { [extra]: 'Extra' }, presentation: { ...sheet.presentation, columnWidths: { [extra]: 125 } } }]), dataModels: { model } };
    const bound = successful(bindSheetToModel(initial, sheet.id, model.id, () => 'new'));
    const changed = successful(replaceModelDeclaration(bound, { ...model, columns: [...model.columns, { id: 'new', name: 'New', kind: 'manual', type: 'float' }] }, () => 'new'));
    const reloaded = decodeWorkbookBundle(JSON.parse(JSON.stringify(encodeWorkbookBundle(changed))));

    expect(reloaded.documents.sheet.content.columns).toEqual([sheet.content.columns[0], 'new', extra]);
    expect(reloaded.documents.sheet.columnNames).toEqual({ [extra]: 'Extra' });
    expect(reloaded.documents.sheet.presentation.columnWidths[extra]).toBe(125);
    expect(cellRawContent(reloaded.documents.sheet, 'C1')).toBe('42');
  });
  it('preserves a grid-pasted formula-like literal through workbook serialization', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
    const workbook = workbookWithSheets([sheet]);
    const paste = preparePasteCellWrites(workbook, sheet.id, cellIdentityAt(sheet.content, 'A1')!, {
      ok: true, value: { kind: 'external', grid: { rowCount: 1, columnCount: 1, rows: [['=1+2']] } },
    });
    if (!paste.ok) throw new Error(paste.reason);
    const applied = applyWorkbookOperation(workbook, { kind: 'write-cells', operationId: 'paste', writes: paste.writes });
    if (!applied.ok) throw new Error(applied.reason);

    const reloaded = decodeWorkbookBundle(JSON.parse(JSON.stringify(encodeWorkbookBundle(applied.value.nextWorkbook))));
    const raw = cellRawContent(reloaded.documents.sheet!, 'A1')!;
    expect(decodeCellTextLiteral(raw)).toBe('=1+2');
    expect(displayRawCellValue(raw)).toEqual({ kind: 'text', value: '=1+2', display: '=1+2' });
    expect(new FormulaCalculation().update(calculationProjection(reloaded), { kind: 'structure' }).sheet).toEqual({});
  });

  it('sends complete compare-and-swap snapshots and keeps frozen errors and formula-looking text non-executable on reload', async () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2 });
    const model: DataModel = { id: 'model', name: 'Model', columns: [
      { id: 'text', name: 'Text', kind: 'calculated', type: 'string', formula: '="=1+2"' },
      { id: 'error', name: 'Error', kind: 'calculated', type: 'float', formula: '=1/0' },
    ] };
    const before: Workbook = { ...workbookWithSheets([sheet]), dataModels: { model } };
    const bound = successful(bindSheetToModel(before, sheet.id, model.id, () => 'new'));
    const after = successful(unbindSheetFromModel(bound, sheet.id));
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(encodeWorkbookBundle(after)), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    const reloaded = await workbookApi.saveModelLifecycle(bound, after);

    expect(fetch).toHaveBeenCalledWith('/api/workbook/model-lifecycle', expect.objectContaining({ method: 'PUT' }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ before: encodeWorkbookBundle(bound), after: encodeWorkbookBundle(after) });
    expect(decodeCellTextLiteral(cellRawContent(reloaded.documents.sheet!, 'A1')!)).toBe('=1+2');
    expect(decodeCellTextLiteral(cellRawContent(reloaded.documents.sheet!, 'B1')!)).toBe('#DIV/0!');
    expect(new FormulaCalculation().update(calculationProjection(reloaded), { kind: 'structure' }).sheet).toEqual({});
    expect(reloaded.documents.sheet!.modelId).toBeUndefined();
  });

  it('retains stable targets and broken removed properties through serialized reload and same-name reuse', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 3, cells: { A1: '4' } });
    const model: DataModel = { id: 'model', name: 'Model', columns: [
      { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
      { id: 'output', name: 'Output', kind: 'calculated', type: 'float', formula: "=@'Input'[1]*2" },
    ] };
    const workbook = successful(bindSheetToModel({ ...workbookWithSheets([sheet]), dataModels: { model } }, sheet.id, model.id, () => 'new'));
    const removed = successful(replaceModelDeclaration(workbook, { ...model, columns: [model.columns[1]!] }, () => 'fresh'));
    const reloaded = decodeWorkbookBundle(JSON.parse(JSON.stringify(encodeWorkbookBundle(removed))));
    const reused = successful(replaceModelDeclaration(reloaded, { ...model, columns: [model.columns[1]!, { ...model.columns[0]!, id: 'replacement' }] }, () => 'replacement-column'));
    const roundTrip = decodeWorkbookBundle(JSON.parse(JSON.stringify(encodeWorkbookBundle(reused))));
    const results = new FormulaCalculation().updateStored(calculationProjection(roundTrip), roundTrip, { kind: 'structure' });

    expect(roundTrip.documents.sheet!.modelColumnBindings?.output).toBe(workbook.documents.sheet!.modelColumnBindings?.output);
    expect(roundTrip.documents.sheet!.modelColumnBindings?.replacement).toBe('replacement-column');
    expect(results.sheet.A1?.display).toBe('#REF!');
  });
});
