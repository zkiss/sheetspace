import { columnIndexToLabel, type CellAddress } from './cellAddress';
import { formatSheetReferenceToken, formulaReferenceLexemes, formulaSheetReferences, replaceFormulaQualifiers, type FormulaReferenceLexeme } from './formulaSyntax';
import type { ColumnId, RowId, SheetId, Workbook } from './workbookModel';
import { findSheetById, sheetsInOrder } from './workbookQueries';

export type FormulaCoordinate = { columnId: ColumnId; rowId: RowId };
export type FormulaAxisAnchor = { column: boolean; row: boolean };
export type FormulaSourceSpan = { start: number; end: number };
export type FormulaQualifier = { kind: 'unqualified' } | { kind: 'explicit'; sheetId: SheetId; sourceSpan: FormulaSourceSpan } | { kind: 'broken'; sourceSpan: FormulaSourceSpan };
export type FormulaReferenceEndpoint = { anchors: FormulaAxisAnchor; sourceSpan: FormulaSourceSpan } & ({ kind: 'canonical'; coordinate: FormulaCoordinate } | { kind: 'a1'; address: CellAddress });
export type FormulaReferenceToken = { kind: 'cell' | 'range'; qualifier: FormulaQualifier; endpoints: readonly [FormulaReferenceEndpoint, FormulaReferenceEndpoint?]; sourceSpan: FormulaSourceSpan };
export type FormulaReferenceResolver = { currentSheetId: SheetId; sheetByQualifier(qualifier: string): SheetId | undefined; displaySheetQualifier?(sheetId: SheetId): string | undefined; coordinateAt(sheetId: SheetId, address: CellAddress): FormulaCoordinate | undefined; addressOf(sheetId: SheetId, coordinate: FormulaCoordinate): CellAddress | undefined };
export type FormulaTransformResult = { ok: true; raw: string } | { ok: false; reason: 'unresolved-coordinate' };
export type FormulaCopyContext = { sourceSheetId?: SheetId; destinationSheetId?: SheetId };
export type FormulaDisplayProjection = { raw: string; referenceSpans: readonly FormulaSourceSpan[] };

type Endpoint = { kind: 'a1' | 'canonical'; address?: CellAddress; coordinate?: FormulaCoordinate; anchors: FormulaAxisAnchor; sourceSpan: FormulaSourceSpan };
type Match = { sourceSpan: FormulaSourceSpan; qualifier: FormulaQualifier; endpoints: Endpoint[]; canonical: boolean };
type Edit = FormulaSourceSpan & { value: string };

/** A1 recognition is delegated to formulaSyntax, including its malformed-formula recovery. */
export function formulaReferenceTokens(raw: string): FormulaReferenceToken[] { return lexemeMatches(raw).map(toToken); }

export function formulaRawToCanonical(raw: string, resolver: FormulaReferenceResolver): string {
  const edits: Edit[] = [];
  for (const match of rawMatches(raw)) {
    const sheetId = rawTargetSheet(match.qualifier, resolver);
    const coordinates = sheetId && match.endpoints.map((endpoint) => resolver.coordinateAt(sheetId, endpoint.address!));
    if (!sheetId || !coordinates || coordinates.some((coordinate) => !coordinate)) { edits.push({ ...match.sourceSpan, value: '#REF!' }); continue; }
    if (match.qualifier.kind === 'explicit') edits.push({ ...match.qualifier.sourceSpan, value: formatSheetReferenceToken(sheetId) });
    match.endpoints.forEach((endpoint, index) => edits.push({ ...endpoint.sourceSpan, value: formatCanonical(coordinates[index]!, endpoint.anchors) }));
  }
  return applyEdits(raw, edits);
}

export function formulaRawToDisplay(raw: string, resolver: FormulaReferenceResolver): string {
  return displayProjection(raw, resolver).raw;
}

export function formulaRawForStorage(raw: string, workbook: Workbook, currentSheetId?: SheetId): string {
  if (currentSheetId) return formulaRawToCanonical(raw, workbookFormulaReferenceResolver(workbook, currentSheetId));
  return replaceFormulaQualifiers(raw, (reference) => {
    if (reference === '#REF') return reference;
    const sheetId = sheetsInOrder(workbook).find((sheet) => sheet.name === reference || sheet.id === reference)?.id;
    return sheetId ? formatSheetReferenceToken(sheetId) : '#REF';
  });
}

export function formulaRawForDisplay(raw: string, workbook: Workbook, currentSheetId?: SheetId): string {
  if (currentSheetId && formulaReferenceTokens(raw).some((reference) => reference.endpoints.some((endpoint) => endpoint?.kind === 'canonical'))) return formulaRawToDisplay(raw, workbookFormulaReferenceResolver(workbook, currentSheetId));
  return replaceFormulaQualifiers(raw, (sheetReference) => { const sheet = findSheetById(workbook, sheetReference); return sheet ? formatSheetReferenceToken(sheet.name) : '#REF'; });
}

export function formulaSheetReferenceIds(raw: string): string[] { return formulaSheetReferences(raw).filter((sheetId) => sheetId !== '#REF'); }

/** Returns rendered canonical-reference spans, including replacements such as #REF!. */
export function formulaRawToDisplayProjection(raw: string, resolver: FormulaReferenceResolver): FormulaDisplayProjection {
  return displayProjection(raw, resolver);
}

function displayProjection(raw: string, resolver: FormulaReferenceResolver): FormulaDisplayProjection {
  const edits: Edit[] = [];
  const matches = canonicalMatches(raw);
  for (const match of matches) {
    const sheetId = targetSheet(match.qualifier, resolver.currentSheetId);
    const addresses = sheetId && match.endpoints.map((endpoint) => endpoint.coordinate && resolver.addressOf(sheetId, endpoint.coordinate));
    if (!sheetId || !addresses || addresses.some((address) => !address)) { edits.push({ ...match.sourceSpan, value: '#REF!' }); continue; }
    if (match.qualifier.kind === 'explicit') {
      const display = resolver.displaySheetQualifier?.(sheetId);
      if (!display) { edits.push({ ...match.sourceSpan, value: '#REF!' }); continue; }
      edits.push({ ...match.qualifier.sourceSpan, value: display });
    }
    match.endpoints.forEach((endpoint, index) => edits.push({ ...endpoint.sourceSpan, value: formatA1(addresses[index]!, endpoint.anchors) }));
  }
  return {
    raw: applyEdits(raw, edits),
    referenceSpans: matches.map((match) => displaySpan(match.sourceSpan, edits)),
  };
}

export function copyCanonicalFormula(raw: string, source: FormulaCoordinate, destination: FormulaCoordinate, resolver: FormulaReferenceResolver, context: FormulaCopyContext = {}): FormulaTransformResult {
  const sourceSheetId = context.sourceSheetId ?? resolver.currentSheetId; const destinationSheetId = context.destinationSheetId ?? sourceSheetId;
  const origin = resolver.addressOf(sourceSheetId, source); const target = resolver.addressOf(destinationSheetId, destination);
  if (!origin || !target) return { ok: false, reason: 'unresolved-coordinate' };
  const edits: Edit[] = [];
  for (const match of canonicalMatches(raw)) {
    const originalSheet = targetSheet(match.qualifier, sourceSheetId);
    if (!originalSheet) return { ok: false, reason: 'unresolved-coordinate' };
    const resultSheet = match.qualifier.kind === 'unqualified' ? destinationSheetId : originalSheet;
    for (const endpoint of match.endpoints) {
      const address = endpoint.coordinate && resolver.addressOf(originalSheet, endpoint.coordinate);
      if (!address) return { ok: false, reason: 'unresolved-coordinate' };
      const coordinate = resolver.coordinateAt(resultSheet, { columnIndex: endpoint.anchors.column ? address.columnIndex : address.columnIndex + target.columnIndex - origin.columnIndex, rowIndex: endpoint.anchors.row ? address.rowIndex : address.rowIndex + target.rowIndex - origin.rowIndex });
      if (!coordinate) return { ok: false, reason: 'unresolved-coordinate' };
      edits.push({ ...endpoint.sourceSpan, value: formatCanonical(coordinate, endpoint.anchors) });
    }
  }
  return { ok: true, raw: applyEdits(raw, edits) };
}

export function moveCanonicalFormula(raw: string): FormulaTransformResult { return { ok: true, raw }; }

export function workbookFormulaReferenceResolver(workbook: Workbook, currentSheetId: SheetId): FormulaReferenceResolver {
  const sheet = (id: SheetId) => workbook.documents[id];
  return { currentSheetId,
    sheetByQualifier: (qualifier) => Object.values(workbook.documents).find((entry) => entry.id === qualifier || entry.name === qualifier)?.id,
    displaySheetQualifier: (sheetId) => { const name = sheet(sheetId)?.name; return name && (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`); },
    coordinateAt: (sheetId, address) => { const content = sheet(sheetId)?.content; const rowId = content?.rows[address.rowIndex]; const columnId = content?.columns[address.columnIndex]; return rowId && columnId ? { rowId, columnId } : undefined; },
    addressOf: (sheetId, coordinate) => { const content = sheet(sheetId)?.content; if (!content) return undefined; const rowIndex = content.rows.indexOf(coordinate.rowId); const columnIndex = content.columns.indexOf(coordinate.columnId); return rowIndex < 0 || columnIndex < 0 ? undefined : { rowIndex, columnIndex }; },
  };
}

function rawMatches(raw: string): Match[] { return lexemeMatches(raw).filter((match) => !match.canonical); }
function lexemeMatches(raw: string): Match[] { return formulaReferenceLexemes(raw).map(matchFromLexeme); }
function matchFromLexeme(lexeme: FormulaReferenceLexeme): Match { const qualifier: FormulaQualifier = !lexeme.qualifier ? { kind: 'unqualified' } : lexeme.qualifier.broken ? { kind: 'broken', sourceSpan: lexeme.qualifier.sourceSpan } : { kind: 'explicit', sheetId: lexeme.qualifier.value, sourceSpan: lexeme.qualifier.sourceSpan }; return { sourceSpan: lexeme.sourceSpan, qualifier, endpoints: lexeme.endpoints.map((endpoint) => endpoint.kind === 'a1' ? { kind: 'a1', address: endpoint.value as CellAddress, anchors: endpoint.anchors, sourceSpan: endpoint.sourceSpan } : { kind: 'canonical', coordinate: endpoint.value as FormulaCoordinate, anchors: endpoint.anchors, sourceSpan: endpoint.sourceSpan }), canonical: lexeme.endpoints[0]?.kind === 'canonical' }; }
function canonicalMatches(raw: string): Match[] { return lexemeMatches(raw).filter((match) => match.canonical); }
function toToken(match: Match): FormulaReferenceToken { return { kind: match.endpoints.length === 2 ? 'range' : 'cell', qualifier: match.qualifier, endpoints: match.endpoints.map((endpoint) => endpoint.kind === 'canonical' ? { kind: 'canonical', coordinate: endpoint.coordinate!, anchors: endpoint.anchors, sourceSpan: endpoint.sourceSpan } : { kind: 'a1', address: endpoint.address!, anchors: endpoint.anchors, sourceSpan: endpoint.sourceSpan }) as [FormulaReferenceEndpoint, FormulaReferenceEndpoint?], sourceSpan: match.sourceSpan }; }
function targetSheet(qualifier: FormulaQualifier, current: SheetId): SheetId | undefined { return qualifier.kind === 'broken' ? undefined : qualifier.kind === 'explicit' ? qualifier.sheetId : current; }
function rawTargetSheet(qualifier: FormulaQualifier, resolver: FormulaReferenceResolver): SheetId | undefined { return qualifier.kind === 'explicit' ? resolver.sheetByQualifier(qualifier.sheetId) : targetSheet(qualifier, resolver.currentSheetId); }
function formatCanonical(coordinate: FormulaCoordinate, anchors: FormulaAxisAnchor): string { return `@[${anchors.column ? '$' : ''}${coordinate.columnId},${anchors.row ? '$' : ''}${coordinate.rowId}]`; }
function formatA1(address: CellAddress, anchors: FormulaAxisAnchor): string { return `${anchors.column ? '$' : ''}${columnIndexToLabel(address.columnIndex)}${anchors.row ? '$' : ''}${address.rowIndex + 1}`; }
function displaySpan(sourceSpan: FormulaSourceSpan, edits: readonly Edit[]): FormulaSourceSpan {
  const changeBefore = edits.filter((edit) => edit.end <= sourceSpan.start)
    .reduce((total, edit) => total + edit.value.length - (edit.end - edit.start), 0);
  const changeWithin = edits.filter((edit) => edit.start >= sourceSpan.start && edit.end <= sourceSpan.end)
    .reduce((total, edit) => total + edit.value.length - (edit.end - edit.start), 0);
  return { start: sourceSpan.start + changeBefore, end: sourceSpan.end + changeBefore + changeWithin };
}
function applyEdits(raw: string, edits: Edit[]): string { return [...edits].sort((a, b) => b.start - a.start).reduce((result, edit) => result.slice(0, edit.start) + edit.value + result.slice(edit.end), raw); }
