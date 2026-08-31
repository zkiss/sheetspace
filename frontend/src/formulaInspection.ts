import { cellIdentityAt, stableRangeAt } from './stableCellIdentity';
import { findSheetById } from './workbookQueries';
import { formulaRawForDisplay, formulaRawToDisplayProjection, workbookFormulaReferenceResolver } from './formulaReference';
import { type SheetDocument, type StableCellIdentity, type StableCellRange, type Workbook } from './workbookModel';
import {
  collectFormulaReferences,
  parseFormulaSyntax,
  type FormulaReference,
  type FormulaSourceSpan,
} from './formulaSyntax';

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

export type FormulaInspectionPart =
  | { kind: 'text'; text: string }
  | FormulaInspectionReference;

export type FormulaInspection = {
  raw: string;
  references: FormulaInspectionReference[];
  parts: FormulaInspectionPart[];
};

export function inspectFormula(
  canonicalRaw: string,
  workbook: Workbook,
  currentSheet: SheetDocument,
): FormulaInspection | undefined {
  const parsed = parseFormulaSyntax(canonicalRaw, { preserveUnknownFunctions: true });
  if (parsed.result.kind === 'not-formula' || parsed.references.length === 0) {
    return undefined;
  }

  const formulaReferences = (parsed.result.kind === 'formula'
    ? collectFormulaReferences(parsed.result.expression)
    : parsed.references)
    .sort((first, second) => first.sourceSpan.start - second.sourceSpan.start);
  const raw = formulaRawForDisplay(canonicalRaw, workbook, currentSheet.id);
  const hasCanonicalReference = formulaReferences.some((reference) => reference.kind === 'canonical');
  const displaySpans = hasCanonicalReference
    ? referenceDisplaySpans(
      formulaReferences,
      formulaRawToDisplayProjection(
        canonicalRaw,
        workbookFormulaReferenceResolver(workbook, currentSheet.id),
      ).referenceSpans,
    )
    : parsedDisplaySpans(raw, formulaReferences);
  const references = formulaReferences.map((reference, index) =>
    inspectionReference(reference, raw, displaySpans[index]!, workbook, currentSheet),
  );

  return {
    raw,
    references,
    parts: inspectionParts(raw, references),
  };
}

function parsedDisplaySpans(raw: string, references: readonly FormulaReference[]): FormulaSourceSpan[] {
  const parsed = parseFormulaSyntax(raw, { preserveUnknownFunctions: true });
  const displayReferences = (parsed.result.kind === 'formula'
    ? collectFormulaReferences(parsed.result.expression)
    : parsed.references)
    .sort((first, second) => first.sourceSpan.start - second.sourceSpan.start);
  return references.map((reference, index) => displayReferences[index]?.sourceSpan ?? reference.sourceSpan);
}

/**
 * Rendering a broken canonical reference replaces its whole token with #REF!,
 * which cannot be reparsed as a reference. Keep the source-to-display mapping
 * from the original parsed tokens so inspection still exposes that target.
 */
function referenceDisplaySpans(
  references: readonly FormulaReference[],
  canonicalSpans: readonly FormulaSourceSpan[],
): FormulaSourceSpan[] {
  const canonical = references.filter((reference) => reference.kind === 'canonical');
  let canonicalIndex = 0;
  return references.map((reference) => {
    if (reference.kind === 'canonical') return canonicalSpans[canonicalIndex++]!;
    const priorCanonical = canonicalSpans.slice(0, canonicalIndex)
      .filter((_, index) => canonical[index]!.sourceSpan.end <= reference.sourceSpan.start);
    const sourceLength = canonical.slice(0, priorCanonical.length)
      .reduce((total, item) => total + item.sourceSpan.end - item.sourceSpan.start, 0);
    const displayLength = priorCanonical.reduce((total, span) => total + span.end - span.start, 0);
    const shift = displayLength - sourceLength;
    return { start: reference.sourceSpan.start + shift, end: reference.sourceSpan.end + shift };
  });
}

function inspectionReference(
  reference: FormulaReference,
  displayRaw: string,
  displaySpan: FormulaSourceSpan,
  workbook: Workbook,
  currentSheet: SheetDocument,
): FormulaInspectionReference {
  if (reference.kind === 'canonical') {
    const sheetId = reference.sheetId ?? currentSheet.id;
    const targetSheet = findSheetById(workbook, sheetId);
    const range = reference.range
      ? { start: { rowId: reference.range.start.rowId, columnId: reference.range.start.columnId }, end: { rowId: reference.range.end.rowId, columnId: reference.range.end.columnId } }
      : undefined;
    const identity = !reference.range
      ? { rowId: reference.coordinate.rowId, columnId: reference.coordinate.columnId }
      : undefined;
    const valid = targetSheet && (range
      ? targetSheet.content.rows.includes(range.start.rowId) && targetSheet.content.columns.includes(range.start.columnId)
        && targetSheet.content.rows.includes(range.end.rowId) && targetSheet.content.columns.includes(range.end.columnId)
      : identity && targetSheet.content.rows.includes(identity.rowId) && targetSheet.content.columns.includes(identity.columnId));
    return {
      kind: 'reference',
      text: displayRaw.slice(displaySpan.start, displaySpan.end),
      sourceSpan: reference.sourceSpan,
      displaySpan,
      target: range ? { kind: 'range', sheetId, range } : { kind: 'cell', sheetId, identity },
      broken: !valid,
      navigable: Boolean(valid),
    };
  }
  const sheetId = reference.sheetId ?? currentSheet.id;
  const targetSheet = findSheetById(workbook, sheetId);
  const target: FormulaReferenceTarget = reference.kind === 'cell'
    ? {
        kind: 'cell',
        sheetId,
        identity: targetSheet ? cellIdentityAt(targetSheet.content, reference.address) : undefined,
      }
    : {
        kind: 'range',
        sheetId,
        range: targetSheet ? stableRangeAt(targetSheet.content, reference.range) : undefined,
      };
  const broken = !targetSheet || (target.kind === 'cell' ? !target.identity : !target.range);

  return {
    kind: 'reference',
    text: displayRaw.slice(displaySpan.start, displaySpan.end),
    sourceSpan: reference.sourceSpan,
    displaySpan,
    target,
    broken,
    navigable: !broken,
  };
}

function inspectionParts(
  raw: string,
  references: readonly FormulaInspectionReference[],
): FormulaInspectionPart[] {
  const parts: FormulaInspectionPart[] = [];
  let cursor = 0;
  for (const reference of references) {
    if (reference.displaySpan.start > cursor) {
      parts.push({ kind: 'text', text: raw.slice(cursor, reference.displaySpan.start) });
    }
    parts.push(reference);
    cursor = reference.displaySpan.end;
  }
  if (cursor < raw.length) {
    parts.push({ kind: 'text', text: raw.slice(cursor) });
  }
  return parts;
}
