import { describe, expect, it } from 'vitest';
import { copyCanonicalFormula, formulaRawToCanonical, workbookFormulaReferenceResolver } from './reference';
import { parseFormula } from './syntax';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import cases from './formula-contract-cases.json';

/** Fixed contexts shared by the backend formula contract conformance tests. */
describe('backend formula contract conformance', () => {
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

  it('asserts the shared fixture classifications with the authoritative parser', () => {
    for (const entry of cases.syntax) {
      expect(parseFormula(entry.raw).kind === 'formula', entry.raw).toBe(entry.accepted);
    }
  });
});
