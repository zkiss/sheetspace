import { referenceColour } from '@reference-navigation/contextualReferenceProjection';
import type { FormulaInspectionReference } from '@workbook/formula/formulaInspectionContracts';

export function errorReferenceKey(reference: FormulaInspectionReference): string {
  const target = reference.target;
  return target.kind === 'cell' ? JSON.stringify([target.sheetId, target.identity?.rowId, target.identity?.columnId]) : JSON.stringify(target);
}

export function allocateErrorReferenceColors(references: readonly FormulaInspectionReference[], allocated: ReadonlyMap<string, string> = new Map()): ReadonlyMap<string, string> {
  let colors: Map<string, string> | undefined;
  for (const reference of references) {
    const key = errorReferenceKey(reference);
    if ((colors ?? allocated).has(key)) continue;
    colors ??= new Map(allocated);
    colors.set(key, referenceColour(colors.size));
  }
  return colors ?? allocated;
}
