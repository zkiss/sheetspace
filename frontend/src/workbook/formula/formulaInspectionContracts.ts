import type { StableCellIdentity, StableCellRange } from '@workbook/core/model';
import type { FormulaSourceSpan } from './syntax';

export type FormulaReferenceTarget =
  | {
      kind: 'cell';
      sheetId: string;
      identity?: StableCellIdentity;
    }
  | {
      kind: 'range';
      sheetId: string;
      range?: StableCellRange;
    };

export type FormulaInspectionReference = {
  kind: 'reference';
  text: string;
  sourceSpan: FormulaSourceSpan;
  displaySpan: FormulaSourceSpan;
  target: FormulaReferenceTarget;
  broken: boolean;
  navigable: boolean;
};

