import { describe, expect, it } from 'vitest';
import { copyCanonicalFormula, formulaRawToCanonical, workbookFormulaReferenceResolver } from './reference';
import { parseFormula } from './syntax';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

/** Fixed contexts shared by the backend formula contract conformance tests. */
describe('backend formula contract conformance', () => {
  const local = sheetDocument({ id: 'sheet-0', name: 'Local', columnCount: 2, rowCount: 2 });
  const other = sheetDocument({ id: 'sheet-1', name: 'Other sheet', columnCount: 2, rowCount: 2 });
  const resolver = workbookFormulaReferenceResolver(workbookWithSheets([local, other]), local.id);

  it('derives qualified canonical and copy raws with exact source spelling', () => {
    const canonical = formulaRawToCanonical("=@'Other sheet' ! A[1] + @A[1]", resolver);

    expect(canonical).toBe('=@sheet-1 ! sheet-1:column:1[sheet-1:row:1] + @sheet-0:column:1[sheet-0:row:1]');
    expect(copyCanonicalFormula(
      canonical,
      { columnId: 'sheet-0:column:1', rowId: 'sheet-0:row:1' },
      { columnId: 'sheet-0:column:2', rowId: 'sheet-0:row:2' },
      resolver,
    )).toEqual({ ok: true, raw: '=@sheet-1 ! sheet-1:column:2[sheet-1:row:2] + @sheet-0:column:2[sheet-0:row:2]' });
  });

  it('parses supported and unsupported error-shaped text consistently', () => {
    expect(parseFormula('=#DIV/0!')).toMatchObject({ kind: 'error', error: '#PARSE!' });
    expect(parseFormula('=#NOT-A-FRONTEND-ERROR!')).toMatchObject({ kind: 'error', error: '#PARSE!' });
  });
});
