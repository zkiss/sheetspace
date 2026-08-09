import {
  cellIdentityAt,
  findSheetById,
  stableRangeAt,
  type SheetDocument,
  type StableCellIdentity,
  type StableCellRange,
  type Workbook,
} from './workbook';
import {
  collectFormulaReferences,
  formatSheetReferenceToken,
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

type QualifierReplacement = FormulaSourceSpan & { text: string };

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
  const replacements = qualifierReplacements(formulaReferences, workbook);
  const raw = applyQualifierReplacements(canonicalRaw, replacements);
  const references = formulaReferences.map((reference) =>
    inspectionReference(reference, raw, replacements, workbook, currentSheet),
  );

  return {
    raw,
    references,
    parts: inspectionParts(raw, references),
  };
}

function qualifierReplacements(
  references: readonly FormulaReference[],
  workbook: Workbook,
): QualifierReplacement[] {
  return references.flatMap((reference) => {
    if (!reference.sheetReferenceSpan || reference.sheetId === undefined) {
      return [];
    }

    const sheet = findSheetById(workbook, reference.sheetId);
    return [{
      ...reference.sheetReferenceSpan,
      text: sheet ? formatSheetReferenceToken(sheet.name) : '#REF',
    }];
  });
}

function applyQualifierReplacements(
  canonicalRaw: string,
  replacements: readonly QualifierReplacement[],
): string {
  return [...replacements]
    .sort((first, second) => second.start - first.start)
    .reduce(
      (raw, replacement) =>
        raw.slice(0, replacement.start) + replacement.text + raw.slice(replacement.end),
      canonicalRaw,
    );
}

function inspectionReference(
  reference: FormulaReference,
  displayRaw: string,
  replacements: readonly QualifierReplacement[],
  workbook: Workbook,
  currentSheet: SheetDocument,
): FormulaInspectionReference {
  const sheetId = reference.sheetId ?? currentSheet.id;
  const targetSheet = findSheetById(workbook, sheetId);
  const displaySpan = translatedSpan(reference.sourceSpan, replacements);
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

function translatedSpan(
  span: FormulaSourceSpan,
  replacements: readonly QualifierReplacement[],
): FormulaSourceSpan {
  return {
    start: span.start + replacementOffsetAt(span.start, replacements),
    end: span.end + replacementOffsetAt(span.end, replacements),
  };
}

function replacementOffsetAt(
  index: number,
  replacements: readonly QualifierReplacement[],
): number {
  return replacements
    .filter((replacement) => replacement.end <= index)
    .reduce(
      (offset, replacement) => offset + replacement.text.length - (replacement.end - replacement.start),
      0,
    );
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
