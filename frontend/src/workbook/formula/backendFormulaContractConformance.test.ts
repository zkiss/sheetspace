import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyCanonicalFormula, formulaRawToCanonical, workbookFormulaReferenceResolver } from './reference';
import { parseFormula } from './syntax';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import cases from './formula-contract-cases.json';
import { addDataModel, bindSheetToDataModel, replaceDataModel } from '../mutations/dataModel';
import { appendRow } from '../mutations/operations';
import { workbookApi } from '@infrastructure/persistence/workbookApi';

/** Fixed contexts shared by the backend formula contract conformance tests. */
describe('backend formula contract conformance', () => {
  afterEach(() => vi.unstubAllGlobals());
  const local = sheetDocument({ id: 'sheet-0', name: 'Local', columnCount: 2, rowCount: 2 });
  const other = sheetDocument({ id: 'sheet-1', name: 'Other sheet', columnCount: 2, rowCount: 2 });
  const resolver = workbookFormulaReferenceResolver(workbookWithSheets([local, other]), local.id);

  it('derives qualified canonical and copy raws with exact source spelling', () => {
    const canonical = formulaRawToCanonical(cases.canonical.raw, resolver);

    expect(canonical).toBe(cases.canonical.output);
    expect(copyCanonicalFormula(
      canonical,
      { columnId: 'sheet-0:column:1', rowId: 'sheet-0:row:1' },
      { columnId: 'sheet-0:column:2', rowId: 'sheet-0:row:2' },
      resolver,
    )).toEqual({ ok: true, raw: cases.canonical.copied });
  });

  it('recovers and copies stable references after generated error text', () => {
    expect(copyCanonicalFormula(
      cases.storedCopy.raw,
      { columnId: 'sheet-0:column:1', rowId: 'sheet-0:row:1' },
      { columnId: 'sheet-0:column:2', rowId: 'sheet-0:row:2' },
      resolver,
    )).toEqual({ ok: true, raw: cases.storedCopy.copied });
  });

  it('asserts the shared fixture classifications with the authoritative parser', () => {
    for (const entry of cases.syntax) {
      expect(parseFormula(entry.raw).kind === 'formula', entry.raw).toBe(entry.accepted);
    }
  });

  it('captures an actual mutation bundle through the workbook API transport', async () => {
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
    const added = addDataModel(workbookWithSheets([sheet]), model);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const bound = bindSheetToDataModel(added.value, sheetId, model.id, []);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    const replaced = replaceDataModel(bound.value, model, { [sheetId]: [] });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    const appendedSheet = appendRow(replaced.value.documents[sheetId]!, '00000000-0000-0000-0000-000000000103', model, replaced.value);
    const workbook = { ...replaced.value, documents: { ...replaced.value.documents, [sheetId]: appendedSheet } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sheets: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await workbookApi.replaceDataModelState(workbook, []);

    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(request.body as string).workbook).toEqual(cases.bundle);
  });
});
