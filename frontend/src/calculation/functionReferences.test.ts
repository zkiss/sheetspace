import { expect, it, vi } from 'vitest';
import * as bodyAnalysis from '@workbook/formula/functionBodyAnalysis';
import { parseFormula } from '@workbook/formula/syntax';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { functionReferences } from './functionReferences';

it('explores each branching definition once while retaining all call argument references', () => {
  const functions = [
    { name: 'f0', parameters: [], body: '=@A[1]' },
    ...Array.from({ length: 30 }, (_, index) => ({
      name: `f${index + 1}`, parameters: [],
      body: `=IF(FALSE,f${index}()+f${index}(),1)`,
    })),
    { name: 'loop', parameters: [], body: '=loop()+@B[1]' },
  ];
  const workbook = { ...workbookWithSheets([sheetDocument({ id: 's', name: 'Sheet' })]), functions };
  const parsed = parseFormula('=f30()+loop()+SUM(f0(@D[1]),@C[1])');
  if (parsed.kind !== 'formula') throw new Error('Expected formula');
  const analyze = vi.spyOn(bodyAnalysis, 'analyzeFunctionBody');
  try {
    const references = functionReferences(parsed.expression, workbook, 's');
    expect(analyze).toHaveBeenCalledTimes(32);
    expect(references).toHaveLength(4);
  } finally {
    analyze.mockRestore();
  }
});
