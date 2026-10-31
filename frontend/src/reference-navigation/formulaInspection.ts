import type { FormulaInspectionReference, FormulaReferenceTarget } from '@workbook/formula/formulaInspectionContracts';
import { cellIdentityAt, stableRangeAt } from '@workbook/core/cellIdentity';
import { namedColumns } from '@workbook/core/columnNames';
import { findSheetById } from '@workbook/read/queries';
import { analyzeFormulaSyntax, formulaRawForDisplay, formulaRawToDisplayProjection, formulaReferenceTokens, workbookFormulaReferenceResolver } from '@workbook/formula/reference';
import { type SheetDocument, type Workbook } from '@workbook/core/model';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import {
  collectFormulaReferences,
  parseFormulaSyntax,
  type FormulaReference,
  type FormulaDiagnostic,
  type FormulaSourceSpan,
} from '@workbook/formula/syntax';

export type FormulaInspectionPart =
  | { kind: 'text'; text: string }
  | FormulaInspectionReference;

export type FormulaInspection = {
  raw: string;
  references: FormulaInspectionReference[];
  parts: FormulaInspectionPart[];
  diagnostics: FormulaDiagnostic[];
};

export function inspectStoredFormula(content: string, workbook: Workbook, currentSheet: SheetDocument): FormulaInspection | undefined {
  const projection = projectStoredFormula(content, workbook, currentSheet.id);
  const analysis = projection.analysis;
  if (analysis.syntax.result.kind === 'not-formula' || analysis.references.length === 0) return undefined;
  const references = analysis.references.map(({ lexeme, reference, live }) => {
    const span = projection.references.find(({ sourceSpan }) => sourceSpan.start === lexeme.sourceSpan.start)?.displaySpan ?? lexeme.sourceSpan;
    if (reference) return inspectionReference(reference, projection.text, span, workbook, currentSheet, !live);
    return {
      kind: 'reference' as const, text: projection.text.slice(span.start, span.end), sourceSpan: span, displaySpan: span,
      target: { kind: lexeme.endpoints.length > 1 ? 'range' as const : 'cell' as const, sheetId: currentSheet.id },
      broken: true, navigable: false,
    };
  });
  return { raw: projection.text, references, parts: inspectionParts(projection.text, references), diagnostics: analysis.diagnostics.map((diagnostic) => ({ ...diagnostic, sourceSpan: projection.displaySpan(diagnostic.sourceSpan) })) };
}

export function inspectFormula(
  canonicalRaw: string,
  workbook: Workbook,
  currentSheet: SheetDocument,
): FormulaInspection | undefined {
  const parsed = analyzeFormulaSyntax(canonicalRaw, workbookFormulaReferenceResolver(workbook, currentSheet.id));
  if (parsed.result.kind === 'not-formula' || parsed.references.length === 0) {
    return undefined;
  }

  const formulaReferences = (parsed.result.kind === 'formula'
    ? collectFormulaReferences(parsed.result.expression)
    : parsed.references)
    .sort((first, second) => first.sourceSpan.start - second.sourceSpan.start);
  const raw = formulaRawForDisplay(canonicalRaw, workbook, currentSheet.id);
  const canonicalReferences = formulaReferenceTokens(canonicalRaw)
    .filter((reference) => reference.endpoints.some((endpoint) => endpoint?.kind === 'canonical'));
  const displaySpans = canonicalReferences.length > 0
    ? referenceDisplaySpans(
      formulaReferences,
      canonicalReferences.map((reference) => reference.sourceSpan),
      formulaRawToDisplayProjection(
        canonicalRaw,
        workbookFormulaReferenceResolver(workbook, currentSheet.id),
      ).referenceSpans,
    )
    : parsedDisplaySpans(raw, formulaReferences);
  const references = formulaReferences.map((reference, index) =>
    inspectionReference(reference, raw, displaySpans[index]!, workbook, currentSheet,
      parsed.diagnostics.some((diagnostic) => diagnostic.kind === 'reference'
        && diagnostic.sourceSpan.start === reference.sourceSpan.start
        && diagnostic.sourceSpan.end === reference.sourceSpan.end)),
  );

  return {
    raw,
    references,
    parts: inspectionParts(raw, references),
    diagnostics: parsed.diagnostics,
  };
}

export function navigableReferencesAtCaret(
  inspection: FormulaInspection | undefined,
  caret: number | undefined,
): FormulaInspectionReference[] {
  const references = inspection?.references.filter((reference) => reference.navigable) ?? [];
  if (caret === undefined) return references;
  const atCaret = references.filter((reference) => caret >= reference.displaySpan.start && caret <= reference.displaySpan.end);
  return atCaret.length ? atCaret : references;
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
  canonical: readonly FormulaSourceSpan[],
  canonicalSpans: readonly FormulaSourceSpan[],
): FormulaSourceSpan[] {
  let canonicalIndex = 0;
  return references.map((reference) => {
    if (canonical[canonicalIndex]?.start === reference.sourceSpan.start) return canonicalSpans[canonicalIndex++]!;
    const priorCanonical = canonicalSpans.slice(0, canonicalIndex)
      .filter((_, index) => canonical[index]!.end <= reference.sourceSpan.start);
    const sourceLength = canonical.slice(0, priorCanonical.length)
      .reduce((total, item) => total + item.end - item.start, 0);
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
  hasReferenceDiagnostic: boolean,
): FormulaInspectionReference {
  if (reference.kind === 'named') {
    return {
      kind: 'reference',
      text: displayRaw.slice(displaySpan.start, displaySpan.end),
      sourceSpan: reference.sourceSpan,
      displaySpan,
      target: { kind: reference.end ? 'range' : 'cell', sheetId: reference.sheetId ?? currentSheet.id },
      broken: true,
      navigable: false,
    };
  }
  if (reference.kind === 'canonical') {
    const sheetId = reference.sheetId ?? currentSheet.id;
    const targetSheet = findSheetById(workbook, sheetId);
    const range = reference.range
      ? { start: { rowId: reference.range.start.rowId, columnId: reference.range.start.columnId }, end: { rowId: reference.range.open ? targetSheet?.content.rows.slice(-1)[0] ?? '' : reference.range.end.rowId, columnId: reference.range.end.columnId } }
      : undefined;
    const identity = !reference.range
      ? { rowId: reference.coordinate.rowId, columnId: reference.coordinate.columnId }
      : undefined;
    const hasProperty = (propertyId: string | undefined, columnId: string) => !propertyId || Boolean(targetSheet && namedColumns(workbook, targetSheet).some((column) => column.id === propertyId && column.columnId === columnId));
    const propertyValid = hasProperty(reference.propertyId, reference.coordinate.columnId)
      && hasProperty(reference.range?.endPropertyId, reference.range?.end.columnId ?? '');
    const valid = propertyValid && targetSheet && (range
      ? targetSheet.content.rows.includes(range.start.rowId) && targetSheet.content.columns.includes(range.start.columnId)
        && targetSheet.content.rows.includes(range.end.rowId) && targetSheet.content.columns.includes(range.end.columnId)
      : identity && targetSheet.content.rows.includes(identity.rowId) && targetSheet.content.columns.includes(identity.columnId));
    return {
      kind: 'reference',
      text: displayRaw.slice(displaySpan.start, displaySpan.end),
      sourceSpan: reference.sourceSpan,
      displaySpan,
      target: range ? { kind: 'range', sheetId, range } : { kind: 'cell', sheetId, identity },
      broken: hasReferenceDiagnostic || !valid,
      navigable: !hasReferenceDiagnostic && Boolean(valid),
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
        range: targetSheet ? stableRangeAt(targetSheet.content, reference.open ? { ...reference.range, end: { ...reference.range.end, rowIndex: targetSheet.content.rows.length - 1 } } : reference.range) : undefined,
      };
  const broken = hasReferenceDiagnostic || !targetSheet || (target.kind === 'cell' ? !target.identity : !target.range);

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
