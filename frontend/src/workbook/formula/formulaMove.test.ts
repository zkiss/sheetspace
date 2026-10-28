import { describe, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { formulaRawToCanonical, formulaRawToDisplay, moveCanonicalFormula, workbookFormulaReferenceResolver } from './reference';

describe('formula move target mapping', () => {
  const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 5, columnCount: 5 });
  const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 5, columnCount: 5 });
  const workbook = workbookWithSheets([source, other]);
  const resolver = workbookFormulaReferenceResolver(workbook, source.id);
  const mapping = (from: string, to: string, destination = source) => ({ source: { sheetId: source.id, cell: cellIdentityAt(source.content, from)! }, destination: { sheetId: destination.id, cell: cellIdentityAt(destination.content, to)! } });
  const transform = (raw: string, mappings: ReturnType<typeof mapping>[], finalSheet = source.id) => moveCanonicalFormula(formulaRawToCanonical(raw, resolver), resolver, finalSheet, mappings);
  const display = (result: ReturnType<typeof transform>, sheetId = source.id) => result.ok ? formulaRawToDisplay(result.raw, workbookFormulaReferenceResolver(workbook, sheetId)) : result;

  it('maps targets once and retains anchors and unrelated text', () => {
    expect(display(transform('=SUM(@$A[$1], @B[1], @C[1], "@A[1]")', [mapping('A1', 'B1'), mapping('B1', 'C1')])))
      .toBe('=SUM(@$B[$1], @C[1], @C[1], "@A[1]")');
  });

  it('qualifies unmoved targets of a moved formula and maps targets across sheets', () => {
    expect(display(transform('=@A[1]+@B[1]+@Source!C[1]', [mapping('A1', 'A2', other)], other.id), other.id))
      .toBe('=@A[2]+@Source!B[1]+@Source!C[1]');
    expect(display(transform('=@Source!A[1]', [mapping('A1', 'B2', other)])))
      .toBe('=@Other!B[2]');
  });

  it('preserves exact rectangular range membership and reversed endpoints', () => {
    expect(display(transform('=SUM(@B[2]:A[1])', [mapping('A1', 'A2'), mapping('B1', 'B2'), mapping('A2', 'A3'), mapping('B2', 'B3')])))
      .toBe('=SUM(@B[3]:A[2])');
    expect(display(transform('=SUM(@A[1]:B[1])', [mapping('A1', 'C1')])))
      .toBe('=SUM(@B[1]:C[1])');
    expect(display(transform('=SUM(@A[1]:B[1])', [mapping('A1', 'B1')])))
      .toBe('=SUM(@B[1]:B[1])');
  });

  it('rejects holes, interior changes and split sheets', () => {
    for (const [raw, mappings] of [
      ['=SUM(@A[1]:C[1])', [mapping('B1', 'E1')]],
      ['=SUM(@A[1]:B[1])', [mapping('A1', 'A1', other)]],
    ] as const) expect(transform(raw, [...mappings])).toEqual({ ok: false, reason: 'unrepresentable-range' });
  });

  it('does not enumerate a large unrelated range when moving a cell', () => {
    const largeResolver = {
      ...resolver,
      addressOf: vi.fn((_sheet, cell) => ({ columnIndex: Number(cell.columnId.slice(1)), rowIndex: Number(cell.rowId.slice(1)) })),
      coordinateAt: vi.fn((_sheet, address) => ({ columnId: `c${address.columnIndex}`, rowId: `r${address.rowIndex}` })),
    } satisfies typeof resolver;
    const raw = '=SUM(@c0[r0]:c9999[r9999])';
    const move = [{ source: { sheetId: source.id, cell: { columnId: 'c10000', rowId: 'r10000' } }, destination: { sheetId: source.id, cell: { columnId: 'c10001', rowId: 'r10001' } } }];
    expect(moveCanonicalFormula(raw, largeResolver, source.id, move)).toEqual({ ok: true, raw });
    expect(largeResolver.coordinateAt).not.toHaveBeenCalled();
    expect(largeResolver.addressOf.mock.calls.length).toBeLessThan(10);
  });

  it('leaves broken references and malformed surrounding syntax intact', () => {
    const raw = '=@#REF!A[1]+@source:column:missing[source:row:1]+(';
    expect(moveCanonicalFormula(raw, resolver, other.id, [mapping('A1', 'B1')])).toEqual({ ok: true, raw });
  });

  it('retains named references when mapped to named columns and falls back for unnamed columns', () => {
    const bound = { ...source, modelId: 'budget', modelColumnBindings: { revenue: source.content.columns[0]!, cost: source.content.columns[1]! } };
    const modelWorkbook = { ...workbookWithSheets([bound, other]), dataModels: { budget: { id: 'budget', name: 'Budget', columns: [
      { id: 'revenue', name: 'Revenue', kind: 'manual' as const, type: 'float' as const },
      { id: 'cost', name: 'Cost', kind: 'manual' as const, type: 'float' as const },
    ] } } };
    const namedResolver = workbookFormulaReferenceResolver(modelWorkbook, source.id);
    const move = (raw: string, mappings: ReturnType<typeof mapping>[]) => {
      const result = moveCanonicalFormula(formulaRawToCanonical(raw, namedResolver), namedResolver, source.id, mappings);
      return result.ok ? formulaRawToDisplay(result.raw, namedResolver) : result;
    };
    expect(move('=@Revenue[1]', [mapping('A1', 'B1')])).toBe('=@Cost[1]');
    expect(move('=@Revenue[1]', [mapping('A1', 'C1')])).toBe('=@C[1]');
    expect(move('=SUM(@Revenue[1]:Cost[1])', [mapping('A1', 'B1'), mapping('B1', 'C1')])).toBe('=SUM(@B[1]:C[1])');
  });

  it('leaves a reference intact when its resolved coordinate is unavailable', () => {
    const raw = formulaRawToCanonical('=@A[1]', resolver);
    const incompleteResolver = { ...resolver, coordinateAt: () => undefined };
    expect(moveCanonicalFormula(raw, incompleteResolver, source.id, [mapping('A1', 'B1')])).toEqual({ ok: true, raw });
  });
});
