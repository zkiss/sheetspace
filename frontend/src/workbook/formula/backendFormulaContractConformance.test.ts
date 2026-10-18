import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyCanonicalFormula, formulaRawForStorage, formulaRawToCanonical, workbookFormulaReferenceResolver } from './reference';
import { parseFormula } from './syntax';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import cases from './formula-contract-cases.json';
import { addDataModel, bindSheetToDataModel, replaceDataModel, validateDataModel } from '../mutations/dataModel';
import { appendRow } from '../mutations/operations';
import { workbookApi } from '@infrastructure/persistence/workbookApi';

const fixedRowsBySheet = {
  '00000000-0000-0000-0000-000000000001': [
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000103',
  ],
  '00000000-0000-0000-0000-000000000002': [
    '00000000-0000-0000-0000-000000000111',
    '00000000-0000-0000-0000-000000000112',
    '00000000-0000-0000-0000-000000000113',
  ],
} as const;

const fixedColumnsBySheet = {
  '00000000-0000-0000-0000-000000000001': [
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000202',
    '00000000-0000-0000-0000-000000000203',
  ],
  '00000000-0000-0000-0000-000000000002': [
    '00000000-0000-0000-0000-000000000211',
    '00000000-0000-0000-0000-000000000212',
    '00000000-0000-0000-0000-000000000213',
  ],
} as const;

function fixedSheet(id: keyof typeof fixedRowsBySheet, name: string, columnCount = 2, rowCount = 2) {
  const sheet = sheetDocument({ id, name, columnCount, rowCount });
  return {
    ...sheet,
    content: {
      ...sheet.content,
      rows: fixedRowsBySheet[id].slice(0, rowCount),
      columns: fixedColumnsBySheet[id].slice(0, columnCount),
    },
  };
}

/** Fixed contexts shared by the backend formula contract conformance tests. */
describe('backend formula contract conformance', () => {
  afterEach(() => vi.unstubAllGlobals());
  const local = fixedSheet('00000000-0000-0000-0000-000000000001', 'Local');
  const other = fixedSheet('00000000-0000-0000-0000-000000000002', 'Other sheet');
  const resolver = workbookFormulaReferenceResolver(workbookWithSheets([local, other]), local.id);

  it('derives qualified canonical and copy raws with exact source spelling', () => {
    const canonical = formulaRawToCanonical(cases.canonical.raw, resolver);

    expect(canonical).toBe(cases.canonical.output);
    expect(copyCanonicalFormula(
      canonical,
      { columnId: '00000000-0000-0000-0000-000000000201', rowId: '00000000-0000-0000-0000-000000000101' },
      { columnId: '00000000-0000-0000-0000-000000000202', rowId: '00000000-0000-0000-0000-000000000102' },
      resolver,
    )).toEqual({ ok: true, raw: cases.canonical.copied });
  });

  it('recovers and copies stable references after generated error text', () => {
    expect(copyCanonicalFormula(
      cases.storedCopy.raw,
      { columnId: '00000000-0000-0000-0000-000000000201', rowId: '00000000-0000-0000-0000-000000000101' },
      { columnId: '00000000-0000-0000-0000-000000000202', rowId: '00000000-0000-0000-0000-000000000102' },
      resolver,
    )).toEqual({ ok: true, raw: cases.storedCopy.copied });

    const threeColumnLocal = fixedSheet('00000000-0000-0000-0000-000000000001', 'Local', 3);
    const threeColumnResolver = workbookFormulaReferenceResolver(workbookWithSheets([threeColumnLocal, other]), threeColumnLocal.id);
    expect(copyCanonicalFormula(
      cases.storedCopyMultiple.raw,
      { columnId: '00000000-0000-0000-0000-000000000201', rowId: '00000000-0000-0000-0000-000000000101' },
      { columnId: '00000000-0000-0000-0000-000000000202', rowId: '00000000-0000-0000-0000-000000000102' },
      threeColumnResolver,
    )).toEqual({ ok: true, raw: cases.storedCopyMultiple.copied });
  });

  it('uses the shared corpus for anchors, ranges, qualifiers, literals, and recovered stored raws', () => {
    const local = fixedSheet('00000000-0000-0000-0000-000000000001', 'Local', 3, 3);
    const other = fixedSheet('00000000-0000-0000-0000-000000000002', "O'Brien", 3, 3);
    const resolver = workbookFormulaReferenceResolver(workbookWithSheets([local, other]), local.id);
    const source = { columnId: '00000000-0000-0000-0000-000000000201', rowId: '00000000-0000-0000-0000-000000000101' };
    const destination = { columnId: '00000000-0000-0000-0000-000000000202', rowId: '00000000-0000-0000-0000-000000000102' };

    for (const entry of cases.transforms) {
      const raw = entry.canonical
        ? formulaRawToCanonical(entry.raw, resolver)
        : entry.raw;
      if (entry.canonical) expect(raw, entry.id).toBe(entry.canonical);
      expect(formulaRawForStorage(entry.raw, workbookWithSheets([local, other]), local.id), entry.id)
        .toBe(entry.canonical ?? entry.raw);
      expect(copyCanonicalFormula(raw, source, destination, resolver), entry.id)
        .toEqual({ ok: true, raw: entry.copied });
      if (entry.storedParseKind) {
        expect(parseFormula(raw).kind, `${entry.id} stored parse classification`).toBe(entry.storedParseKind);
      }
    }

    for (const entry of cases.storageOnly) {
      expect(formulaRawForStorage(entry.raw, workbookWithSheets([local, other]), local.id), entry.id).toBe(entry.raw);
    }
  });

  it('uses the shared corpus for unresolved canonical copy failures', () => {
    const local = fixedSheet('00000000-0000-0000-0000-000000000001', 'Local', 3, 3);
    const resolver = workbookFormulaReferenceResolver(workbookWithSheets([local]), local.id);
    const source = { columnId: '00000000-0000-0000-0000-000000000201', rowId: '00000000-0000-0000-0000-000000000101' };
    const destination = { columnId: '00000000-0000-0000-0000-000000000202', rowId: '00000000-0000-0000-0000-000000000102' };
    for (const entry of cases.copyFailures) {
      expect(copyCanonicalFormula(entry.raw, entry.source ?? source, entry.destination ?? destination, resolver), entry.id)
        .toEqual({ ok: false, reason: 'unresolved-coordinate' });
    }
  });

  it('uses the shared corpus for cross-sheet copy context', () => {
    const local = fixedSheet('00000000-0000-0000-0000-000000000001', 'Local', 3, 3);
    const other = fixedSheet('00000000-0000-0000-0000-000000000002', 'Other sheet', 3, 3);
    const resolver = workbookFormulaReferenceResolver(workbookWithSheets([local, other]), local.id);
    expect(copyCanonicalFormula(cases.crossSheetCopy.raw,
      { columnId: '00000000-0000-0000-0000-000000000201', rowId: '00000000-0000-0000-0000-000000000101' },
      { columnId: '00000000-0000-0000-0000-000000000212', rowId: '00000000-0000-0000-0000-000000000112' },
      resolver,
      { sourceSheetId: local.id, destinationSheetId: other.id },
    ), cases.crossSheetCopy.id).toEqual({ ok: true, raw: cases.crossSheetCopy.copied });
  });

  it('asserts the shared fixture classifications with the authoritative parser', () => {
    for (const entry of cases.syntax) {
      expect(parseFormula(entry.raw).kind === 'formula', entry.raw).toBe(entry.accepted);
      expect(validateDataModel({
        id: 'formula-contract-model', name: 'Formula contract', properties: [
          { id: 'formula-contract-property', name: 'Calculated', kind: 'calculated', formula: entry.raw },
        ],
      }), entry.raw).toEqual(entry.accepted ? undefined : { ok: false, reason: 'invalid-formula' });
    }
  });

  it('captures every shared mutation stage through the workbook API transport', async () => {
    const sheetId = '00000000-0000-0000-0000-000000000001';
    const rows = ['00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102'];
    const columns = ['00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000202'];
    const sheet = {
      ...sheetDocument({ id: sheetId, name: 'Local', rowCount: 0, columnCount: 0 }),
      content: { kind: 'tabular' as const, rows, columns, cells: {} },
    };
    const model = {
      id: '00000000-0000-0000-0000-000000000301', name: 'Metrics', properties: [
        { id: '00000000-0000-0000-0000-000000000401', name: 'Input', kind: 'manual' as const },
        { id: '00000000-0000-0000-0000-000000000402', name: 'Derived', kind: 'calculated' as const, formula: '=@A[1]+1' },
      ],
    };
    const capture = async (workbook: Parameters<typeof workbookApi.replaceDataModelState>[0]) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sheets: [] }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      await workbookApi.replaceDataModelState(workbook, []);
      const request = fetchMock.mock.calls[0]![1] as RequestInit;
      return JSON.parse(request.body as string).workbook;
    };
    const added = addDataModel(workbookWithSheets([{
      ...sheet,
      content: { kind: 'tabular' as const, rows: [], columns: [], cells: {} },
    }]), model);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(await capture(added.value)).toEqual(cases.mutationStages['add-unbound']);

    const targetSheet = fixedSheet('00000000-0000-0000-0000-000000000002', 'Target', 3, 3);
    const richSheet = {
      ...sheet,
      content: { kind: 'tabular' as const, rows, columns: [...columns, '00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000204'], cells: {} },
    };
    const richModel = {
      ...model,
      properties: [
        model.properties[0]!,
        { id: '00000000-0000-0000-0000-000000000402', name: 'Qualified', kind: 'calculated' as const, formula: "=@'Target'!A[1]+1" },
        { id: '00000000-0000-0000-0000-000000000403', name: 'Anchored', kind: 'calculated' as const, formula: '=@$A[$1]+1' },
        { id: '00000000-0000-0000-0000-000000000404', name: 'String', kind: 'calculated' as const, formula: '=SUM("@A[1]", @A[1])' },
      ],
    };
    const addedForRichBind = addDataModel(workbookWithSheets([richSheet, targetSheet]), richModel);
    expect(addedForRichBind.ok).toBe(true);
    if (!addedForRichBind.ok) return;
    const richBound = bindSheetToDataModel(addedForRichBind.value, sheetId, richModel.id, []);
    expect(richBound.ok).toBe(true);
    if (!richBound.ok) return;
    expect(await capture(richBound.value)).toEqual(cases.mutationStages['bind-nonempty']);

    const addedForBind = addDataModel(workbookWithSheets([sheet]), model);
    expect(addedForBind.ok).toBe(true);
    if (!addedForBind.ok) return;
    const bound = bindSheetToDataModel(addedForBind.value, sheetId, model.id, []);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const replacement = {
      ...model,
      properties: [
        model.properties[0]!,
        { ...model.properties[1]!, formula: '=@A[1]+2' },
        { id: '00000000-0000-0000-0000-000000000403', name: 'Further', kind: 'calculated' as const, formula: '=@B[1]+1' },
      ],
    };
    const replaced = replaceDataModel(bound.value, replacement, { [sheetId]: ['00000000-0000-0000-0000-000000000203'] });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(await capture(replaced.value)).toEqual(cases.mutationStages['replace-changed-shape']);

    const zeroRowAdded = addDataModel(workbookWithSheets([{
      ...sheet,
      content: { kind: 'tabular' as const, rows: [], columns, cells: {} },
    }]), model);
    expect(zeroRowAdded.ok).toBe(true);
    if (!zeroRowAdded.ok) return;
    const zeroRowBound = bindSheetToDataModel(zeroRowAdded.value, sheetId, model.id, []);
    expect(zeroRowBound.ok).toBe(true);
    if (!zeroRowBound.ok) return;
    expect(await capture(zeroRowBound.value)).toEqual(cases.mutationStages['bind-zero-row']);
    const firstAppendedSheet = appendRow(zeroRowBound.value.documents[sheetId]!, '00000000-0000-0000-0000-000000000103', model, zeroRowBound.value);
    const firstAppended = { ...zeroRowBound.value, documents: { ...zeroRowBound.value.documents, [sheetId]: firstAppendedSheet } };
    expect(await capture(firstAppended)).toEqual(cases.mutationStages['first-append']);

    const appendedSheet = appendRow(bound.value.documents[sheetId]!, '00000000-0000-0000-0000-000000000103', model, bound.value);
    const appended = { ...bound.value, documents: { ...bound.value.documents, [sheetId]: appendedSheet } };
    expect(await capture(appended)).toEqual(cases.mutationStages['subsequent-append']);
  });

  it('rejects malformed add and replacement mutations before any rows exist', () => {
    const sheetId = '00000000-0000-0000-0000-000000000001';
    const workbook = workbookWithSheets([fixedSheet(sheetId, 'Local', 2, 0)]);
    const malformed = { id: '00000000-0000-0000-0000-000000000301', name: 'Metrics', properties: [
      { id: '00000000-0000-0000-0000-000000000402', name: 'Derived', kind: 'calculated' as const, formula: '=1+' },
    ] };
    expect(addDataModel(workbook, malformed)).toEqual({ ok: false, reason: 'invalid-formula' });
    const valid = { ...malformed, properties: [{ ...malformed.properties[0]!, formula: '=@A[1]+1' }] };
    const added = addDataModel(workbook, valid);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(replaceDataModel(added.value, malformed, {})).toEqual({ ok: false, reason: 'invalid-formula' });
  });

  it('defines six one-component ownership tamper variants from the captured append bundle', () => {
    const original = cases.mutationStages['subsequent-append'].documents[0]!.content.cells;
    const components = new Set(cases.ownershipTampers.map((tamper) => tamper.component));
    expect(components).toEqual(new Set(['qualifier', 'stable-identity', 'anchor', 'range-endpoint', 'operator', 'literal']));
    for (const tamper of cases.ownershipTampers) {
      const changed = tamper.bundle.documents[0]!.content.cells.filter((cell, index) => cell.content !== original[index]!.content);
      expect(changed, tamper.id).toHaveLength(1);
      expect(changed[0]!.rowId, tamper.id).toBe('00000000-0000-0000-0000-000000000103');
      expect(changed[0]!.columnId, tamper.id).toBe('00000000-0000-0000-0000-000000000202');
    }
  });

  it('copies the trusted stored first-row canonical raw instead of recanonicalizing the declaration', () => {
    const scenario = cases.historicalAppend;
    const sheet = {
      ...fixedSheet('00000000-0000-0000-0000-000000000001', 'Local', 2, 0),
      content: { kind: 'tabular' as const, rows: scenario.rows, columns: [scenario.inputColumnId, scenario.calculatedColumnId], cells: {} },
    };
    const model = { id: '00000000-0000-0000-0000-000000000301', name: 'Metrics', properties: [
      { id: '00000000-0000-0000-0000-000000000401', name: 'Input', kind: 'manual' as const },
      { id: '00000000-0000-0000-0000-000000000402', name: 'Derived', kind: 'calculated' as const, formula: scenario.declaration },
    ] };
    const added = addDataModel(workbookWithSheets([sheet]), model);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const bound = bindSheetToDataModel(added.value, sheet.id, model.id, []);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    const sourceKey = `${scenario.rows[0]}\u0000${scenario.calculatedColumnId}`;
    const trusted = {
      ...bound.value,
      documents: {
        ...bound.value.documents,
        [sheet.id]: {
          ...bound.value.documents[sheet.id]!,
          content: { ...bound.value.documents[sheet.id]!.content, cells: { ...bound.value.documents[sheet.id]!.content.cells, [sourceKey]: scenario.storedFirstRaw } },
        },
      },
    };
    const appended = appendRow(trusted.documents[sheet.id]!, scenario.appendRowId, model, trusted);
    expect(appended.content.cells[`${scenario.appendRowId}\u0000${scenario.calculatedColumnId}`], scenario.id).toBe(scenario.expected);
  });
});
