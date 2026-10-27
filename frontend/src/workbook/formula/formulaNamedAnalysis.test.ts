import { describe, expect, it } from 'vitest';
import { inspectFormula } from '@reference-navigation/formulaInspection';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { addDataModel, setSheetModelId, type ModelMutationResult } from '@workbook/mutations/dataModel';
import { analyzeFormulaSyntax, formulaRawToCanonical, workbookFormulaReferenceResolver } from './reference';
import { collectFormulaReferences, parseFormulaSyntax, type FormulaReference } from './syntax';

function stableTargets(references: FormulaReference[]) {
  return references.map((reference) => {
    if (reference.kind !== 'canonical') throw new Error('Expected a resolved stable reference');
    return { sheetId: reference.sheetId, coordinate: reference.coordinate, propertyId: reference.propertyId, range: reference.range };
  });
}

function successful(result: ModelMutationResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function boundWorkbook() {
  const workbook = workbookWithSheets([sheetDocument({ id: 'sheet', name: 'Budget' })]);
  return successful(setSheetModelId(successful(addDataModel(workbook, {
    id: 'model', name: 'Model', columns: [
      { id: 'revenue', name: 'Revenue', kind: 'manual', type: 'float' },
      { id: 'cost', name: 'Cost', kind: 'manual', type: 'float' },
    ],
  })), 'sheet', 'model'));
}

describe('resolver-backed named draft analysis', () => {
  it('represents raw named endpoints without pretending names or positions are stable identities', () => {
    expect(parseFormulaSyntax("=@'Revenue'[1]:'Cost'[2]").references).toEqual([{
      kind: 'named', endpoint: { propertyName: 'Revenue', row: 1 },
      end: { propertyName: 'Cost', row: 2 }, sourceSpan: { start: 1, end: 24 },
    }]);
  });

  it.each([
    "=@'Revenue'[1]",
    "=@Budget!'Revenue'[1]",
    "=SUM(@'Revenue'[1]:'Cost'[2])",
    "=+(@'Revenue'[1]) + -@'Cost'[2]",
    "=IF(TRUE, @'Revenue'[1], 2) + 1",
    "=SUM(@'Revenue'[1],)",
    "=) + @'Revenue'[1]:'Cost'[2]",
  ])('resolves %s to the same navigable stable targets as stored syntax without shifting source spans', (raw) => {
    const workbook = boundWorkbook();
    const sheet = workbook.documents.sheet!;
    const resolver = workbookFormulaReferenceResolver(workbook, sheet.id);
    const parsed = parseFormulaSyntax(raw);
    const analysis = analyzeFormulaSyntax(raw, resolver);
    const canonical = formulaRawToCanonical(raw, resolver);
    const storedAnalysis = analyzeFormulaSyntax(canonical, resolver);
    const inspection = inspectFormula(raw, workbook, sheet)!;
    const storedInspection = inspectFormula(canonical, workbook, sheet)!;

    expect(analysis.result.raw).toBe(raw);
    expect(analysis.references.map((reference) => reference.sourceSpan)).toEqual(parsed.references.map((reference) => reference.sourceSpan));
    expect(analysis.tokens).toEqual(parsed.tokens);
    expect(analysis.diagnostics).toEqual(parsed.diagnostics);
    expect(stableTargets(analysis.references)).toEqual(stableTargets(storedAnalysis.references));
    expect(analysis.references[0]).toMatchObject({
      kind: 'canonical', propertyId: 'revenue', coordinate: { columnId: sheet.content.columns[0], rowId: sheet.content.rows[0] },
    });
    if (raw.includes(":'Cost'[2]")) {
      expect(analysis.references[0]).toMatchObject({
        range: {
          start: { columnId: sheet.content.columns[0], rowId: sheet.content.rows[0] },
          end: { columnId: sheet.content.columns[1], rowId: sheet.content.rows[1] },
          startPropertyId: 'revenue', endPropertyId: 'cost',
        },
      });
    }
    if (analysis.result.kind === 'formula') {
      expect(collectFormulaReferences(analysis.result.expression)).toEqual(analysis.references);
    }
    expect(inspection.raw).toBe(raw);
    expect(inspection.parts.map((part) => part.text).join('')).toBe(raw);
    expect(inspection.references.map((reference) => reference.target)).toEqual(storedInspection.references.map((reference) => reference.target));
    for (const [index, reference] of inspection.references.entries()) {
      expect(reference).toMatchObject({ broken: false, navigable: true, sourceSpan: parsed.references[index]!.sourceSpan });
      expect(reference.text).toBe(raw.slice(reference.sourceSpan.start, reference.sourceSpan.end));
    }
  });

  it('keeps raw and stored named source spans distinct when inspecting mixed syntax', () => {
    const workbook = boundWorkbook();
    const sheet = workbook.documents.sheet!;
    const resolver = workbookFormulaReferenceResolver(workbook, sheet.id);
    const stored = formulaRawToCanonical("=@'Cost'[2]", resolver).slice(1);
    const raw = `=@'Revenue'[1] + ${stored} + @'Revenue'[2]`;

    const inspection = inspectFormula(raw, workbook, sheet)!;

    expect(inspection.raw).toBe("=@'Revenue'[1] + @Cost[2] + @'Revenue'[2]");
    expect(inspection.parts.map((part) => part.text).join('')).toBe(inspection.raw);
    expect(inspection.references.map((reference) => reference.text)).toEqual(["@'Revenue'[1]", '@Cost[2]', "@'Revenue'[2]"]);
    expect(inspection.references.every((reference) => reference.navigable && !reference.broken)).toBe(true);
  });

  it('does not reinterpret persisted A1 sheet identities as names alongside a raw named qualifier', () => {
    const workbook = boundWorkbook();
    const sheet = workbook.documents.sheet!;
    const inspection = inspectFormula("=@Budget!A[1] + @Budget!'Revenue'[1]", workbook, sheet)!;

    expect(inspection.references[0]).toMatchObject({ text: '@#REF!A[1]', broken: true, navigable: false });
    expect(inspection.references[1]).toMatchObject({
      text: "@Budget!'Revenue'[1]", broken: false, navigable: true,
      target: { kind: 'cell', sheetId: sheet.id, identity: { columnId: sheet.content.columns[0], rowId: sheet.content.rows[0] } },
    });
  });

  it.each(["=@'Missing'[1]", "=@'Revenue'[999]", "=@Missing!'Revenue'[1]", "=@'Revenue'[1]:'Missing'[2]"])(
    'keeps unresolved draft %s broken without inventing stable coordinates', (raw) => {
      const workbook = boundWorkbook();
      const sheet = workbook.documents.sheet!;
      const analysis = analyzeFormulaSyntax(raw, workbookFormulaReferenceResolver(workbook, sheet.id));

      expect(analysis.references[0]).toMatchObject({ kind: 'named' });
      expect(analysis.references[0]).not.toHaveProperty('coordinate');
      expect(analysis.diagnostics).toEqual([{ kind: 'reference', code: '#REF!', sourceSpan: { start: 1, end: raw.length } }]);
      expect(inspectFormula(raw, workbook, sheet)?.references[0]).toMatchObject({ broken: true, navigable: false });
    },
  );
});
