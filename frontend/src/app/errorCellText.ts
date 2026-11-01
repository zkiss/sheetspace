import type { FormulaInspectionReference } from '@workbook/formula/formulaInspectionContracts';
import { referenceIdentityColor } from '@workbook/core/referenceIdentity';
import type { WorkbookError, ErrorTraceLine } from './workbookErrors';

export type ErrorCellText = { raw: string; references: FormulaInspectionReference[] };
export type ErrorReferenceHover = { reference: FormulaInspectionReference; element: HTMLElement } | null;

export function errorReferenceColor(reference: FormulaInspectionReference) {
  return referenceIdentityColor(reference.target.kind === 'cell' && reference.target.identity
    ? { kind: 'cell', sheetId: reference.target.sheetId, ...reference.target.identity } : undefined);
}

export function errorCellText(error: WorkbookError, column: number, expanded = false): ErrorCellText {
  const document: ErrorCellText = { raw: '', references: [] };
  const append = (text: string) => { document.raw += text; };
  const reference = (target: NonNullable<ErrorTraceLine['target']>) => {
    const start = document.raw.length;
    append(target.reference);
    const span = { start, end: document.raw.length };
    document.references.push({ kind: 'reference', text: target.reference, sourceSpan: span, displaySpan: span,
      target: { kind: 'cell', sheetId: target.sheetId, identity: target.cell }, broken: false, navigable: true });
  };
  if (column === 0) reference(error);
  else if (column === 1) append(error.code);
  else if (column === 2) {
    if (error.textReference) { append('Could not calculate '); reference(error.textReference); append('.'); }
    else append(error.text);
  } else if (!expanded) {
    reference(error); append(`: ${error.traceMessage ?? error.text}${error.hasCauses ? ' …' : ''}`);
  } else {
    for (const line of error.trace ?? [{ key: error.key, depth: 0, target: error, message: error.text }]) {
      if (document.raw) append('\n');
      if (line.depth) append('  caused by ');
      if (line.target) { reference(line.target); append(': '); }
      append(line.message);
    }
  }
  return document;
}
