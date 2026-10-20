import { columnIndexToLabel, type CellAddress } from '../core/address';
import type { ColumnId, RowId, SheetId, Workbook } from '../core/model';
import { findSheetById, sheetsInOrder } from '../read/queries';
import { formatSheetReferenceToken, formulaReferenceLexemes, formulaSheetReferences, replaceFormulaQualifiers, type FormulaReferenceLexeme } from './syntax';

export type FormulaCoordinate = { columnId: ColumnId; rowId: RowId };
export type FormulaAxisAnchor = { column: boolean; row: boolean };
export type FormulaSourceSpan = { start: number; end: number };
export type FormulaQualifier = { kind: 'unqualified' } | { kind: 'explicit'; sheetId: SheetId; sourceSpan: FormulaSourceSpan } | { kind: 'broken'; sourceSpan: FormulaSourceSpan };
export type FormulaReferenceEndpoint = { anchors: FormulaAxisAnchor; sourceSpan: FormulaSourceSpan } & ({ kind: 'canonical'; coordinate: FormulaCoordinate; propertyId?: string } | { kind: 'a1'; address: CellAddress } | { kind: 'named'; propertyName: string; row: number });
export type FormulaReferenceToken = { kind: 'cell' | 'range'; qualifier: FormulaQualifier; endpoints: readonly [FormulaReferenceEndpoint, FormulaReferenceEndpoint?]; sourceSpan: FormulaSourceSpan };
export type FormulaReferenceResolver = { currentSheetId: SheetId; sheetByQualifier(qualifier: string): SheetId | undefined; displaySheetQualifier?(sheetId: SheetId): string | undefined; coordinateAt(sheetId: SheetId, address: CellAddress): FormulaCoordinate | undefined; addressOf(sheetId: SheetId, coordinate: FormulaCoordinate): CellAddress | undefined; namedCoordinateAt?(sheetId: SheetId, name: string, row: number): { propertyId: string; coordinate: FormulaCoordinate } | undefined; namedAddressOf?(sheetId: SheetId, propertyId: string, coordinate: FormulaCoordinate): { name: string; address: CellAddress } | undefined; namedAddressAt?(sheetId: SheetId, coordinate: FormulaCoordinate): { propertyId: string; name: string; address: CellAddress } | undefined };
export type FormulaTransformResult = { ok: true; raw: string } | { ok: false; reason: 'unresolved-coordinate' };
export type FormulaCopyContext = { sourceSheetId?: SheetId; destinationSheetId?: SheetId };
export type FormulaDisplayProjection = { raw: string; referenceSpans: readonly FormulaSourceSpan[] };

type Endpoint = { kind: 'a1' | 'canonical' | 'named'; address?: CellAddress; coordinate?: FormulaCoordinate; propertyId?: string; propertyName?: string; row?: number; anchors: FormulaAxisAnchor; sourceSpan: FormulaSourceSpan };
type Match = { sourceSpan: FormulaSourceSpan; qualifier: FormulaQualifier; endpoints: Endpoint[]; canonical: boolean };
type Edit = FormulaSourceSpan & { value: string };

/** Reference recognition is delegated to formulaSyntax, including malformed-formula recovery. */
export function formulaReferenceTokens(raw: string): FormulaReferenceToken[] { return lexemeMatches(raw).map(toToken); }

export function formulaRawToCanonical(raw: string, resolver: FormulaReferenceResolver): string {
  const edits: Edit[] = [];
  for (const match of rawMatches(raw)) {
    const sheetId = rawTargetSheet(match.qualifier, resolver);
    const resolved = sheetId && match.endpoints.map((endpoint) => endpoint.kind === 'named'
      ? resolver.namedCoordinateAt?.(sheetId, endpoint.propertyName!, endpoint.row!)
      : { coordinate: resolver.coordinateAt(sheetId, endpoint.address!) });
    if (!sheetId || !resolved || resolved.some((item) => !item?.coordinate)) { edits.push({ ...match.sourceSpan, value: '#REF!' }); continue; }
    if (match.qualifier.kind === 'explicit') edits.push({ ...match.qualifier.sourceSpan, value: sheetId });
    match.endpoints.forEach((endpoint, index) => {
      const item = resolved[index]!;
      const coordinate = item.coordinate!;
      edits.push({ ...endpoint.sourceSpan, value: endpoint.kind === 'named' ? formatNamedCanonical((item as { propertyId: string }).propertyId, coordinate, endpoint.anchors) : formatCanonical(coordinate, endpoint.anchors) });
    });
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
    return sheetId ?? '#REF';
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
    const addresses = sheetId && match.endpoints.map((endpoint) => endpoint.coordinate && (endpoint.propertyId
      ? resolver.namedAddressOf?.(sheetId, endpoint.propertyId, endpoint.coordinate)?.address
      : resolver.addressOf(sheetId, endpoint.coordinate)));
    if (!sheetId || !addresses || addresses.some((address) => !address)) { edits.push({ ...match.sourceSpan, value: '#REF!' }); continue; }
    if (match.qualifier.kind === 'explicit') {
      const display = resolver.displaySheetQualifier?.(sheetId);
      if (!display) { edits.push({ ...match.sourceSpan, value: '#REF!' }); continue; }
      edits.push({ ...match.qualifier.sourceSpan, value: display });
    }
    match.endpoints.forEach((endpoint, index) => {
      const named = endpoint.propertyId && endpoint.coordinate && resolver.namedAddressOf?.(sheetId!, endpoint.propertyId, endpoint.coordinate);
      edits.push({ ...endpoint.sourceSpan, value: named ? formatNamed(named.name, addresses[index]!, endpoint.anchors) : formatA1(addresses[index]!, endpoint.anchors) });
    });
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
      const coordinate = resolver.coordinateAt(resultSheet, translateCopyAddress(address, endpoint.anchors, origin, target));
      if (!coordinate) return { ok: false, reason: 'unresolved-coordinate' };
      if (endpoint.propertyId && !resolver.namedAddressOf?.(originalSheet, endpoint.propertyId, endpoint.coordinate!)) return { ok: false, reason: 'unresolved-coordinate' };
      const named = endpoint.propertyId && resolver.namedAddressAt?.(resultSheet, coordinate);
      edits.push({ ...endpoint.sourceSpan, value: named ? formatNamedCanonical(named.propertyId, coordinate, endpoint.anchors) : formatCanonical(coordinate, endpoint.anchors) });
    }
  }
  return { ok: true, raw: applyEdits(raw, edits) };
}

export function moveCanonicalFormula(raw: string): FormulaTransformResult { return { ok: true, raw }; }

export function workbookFormulaReferenceResolver(workbook: Workbook, currentSheetId: SheetId): FormulaReferenceResolver {
  const sheet = (id: SheetId) => workbook.documents[id];
  const namedAddressOf = (sheetId: SheetId, propertyId: string, coordinate: FormulaCoordinate) => { const document = sheet(sheetId); const model = document?.modelId ? workbook.dataModels?.[document.modelId] : undefined; const property = model?.columns.find((column) => column.id === propertyId); if (!document || !property || document.modelColumnBindings?.[propertyId] !== coordinate.columnId) return undefined; const rowIndex = document.content.rows.indexOf(coordinate.rowId); const columnIndex = document.content.columns.indexOf(coordinate.columnId); return rowIndex < 0 || columnIndex < 0 ? undefined : { name: property.name, address: { rowIndex, columnIndex } }; };
  return { currentSheetId,
    sheetByQualifier: (qualifier) => Object.values(workbook.documents).find((entry) => entry.id === qualifier || entry.name === qualifier)?.id,
    displaySheetQualifier: (sheetId) => { const name = sheet(sheetId)?.name; return name && (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`); },
    coordinateAt: (sheetId, address) => { const content = sheet(sheetId)?.content; const rowId = content?.rows[address.rowIndex]; const columnId = content?.columns[address.columnIndex]; return rowId && columnId ? { rowId, columnId } : undefined; },
    addressOf: (sheetId, coordinate) => { const content = sheet(sheetId)?.content; if (!content) return undefined; const rowIndex = content.rows.indexOf(coordinate.rowId); const columnIndex = content.columns.indexOf(coordinate.columnId); return rowIndex < 0 || columnIndex < 0 ? undefined : { rowIndex, columnIndex }; },
    namedCoordinateAt: (sheetId, name, row) => { const document = sheet(sheetId); const model = document?.modelId ? workbook.dataModels?.[document.modelId] : undefined; const property = model?.columns.find((column) => column.name === name); const columnId = property && document?.modelColumnBindings?.[property.id]; const rowId = document?.content.rows[row - 1]; return property && columnId && rowId && document.content.columns.includes(columnId) ? { propertyId: property.id, coordinate: { columnId, rowId } } : undefined; },
    namedAddressOf,
    namedAddressAt: (sheetId, coordinate) => { const document = sheet(sheetId); const model = document?.modelId ? workbook.dataModels?.[document.modelId] : undefined; const property = model?.columns.find((column) => document?.modelColumnBindings?.[column.id] === coordinate.columnId); const named = property && namedAddressOf(sheetId, property.id, coordinate); return named && property ? { propertyId: property.id, ...named } : undefined; },
  };
}

function rawMatches(raw: string): Match[] { return lexemeMatches(raw).filter((match) => !match.canonical); }
function lexemeMatches(raw: string): Match[] { return formulaReferenceLexemes(raw).map(matchFromLexeme); }
function matchFromLexeme(lexeme: FormulaReferenceLexeme): Match { const qualifier: FormulaQualifier = !lexeme.qualifier ? { kind: 'unqualified' } : lexeme.qualifier.broken ? { kind: 'broken', sourceSpan: lexeme.qualifier.sourceSpan } : { kind: 'explicit', sheetId: lexeme.qualifier.value, sourceSpan: lexeme.qualifier.sourceSpan }; return { sourceSpan: lexeme.sourceSpan, qualifier, endpoints: lexeme.endpoints.map((endpoint) => endpoint.kind === 'a1' ? { kind: 'a1', address: endpoint.value as CellAddress, anchors: endpoint.anchors, sourceSpan: endpoint.sourceSpan } : endpoint.kind === 'named' ? (() => { const value = endpoint.value as { propertyId: string; columnId: string; rowId: string }; return value.columnId ? { kind: 'canonical', coordinate: { columnId: value.columnId, rowId: value.rowId }, propertyId: value.propertyId, anchors: endpoint.anchors, sourceSpan: endpoint.sourceSpan } : { kind: 'named', propertyName: value.propertyId, row: Number(value.rowId), anchors: endpoint.anchors, sourceSpan: endpoint.sourceSpan }; })() : { kind: 'canonical', coordinate: endpoint.value as FormulaCoordinate, anchors: endpoint.anchors, sourceSpan: endpoint.sourceSpan }), canonical: lexeme.endpoints[0]?.kind === 'canonical' || (lexeme.endpoints[0]?.kind === 'named' && Boolean((lexeme.endpoints[0]?.value as { columnId: string }).columnId)) }; }
function canonicalMatches(raw: string): Match[] { return lexemeMatches(raw).filter((match) => match.canonical); }
function toToken(match: Match): FormulaReferenceToken { return { kind: match.endpoints.length === 2 ? 'range' : 'cell', qualifier: match.qualifier, endpoints: match.endpoints.map((endpoint) => endpoint.kind === 'canonical' ? { kind: 'canonical', coordinate: endpoint.coordinate!, ...(endpoint.propertyId ? { propertyId: endpoint.propertyId } : {}), anchors: endpoint.anchors, sourceSpan: endpoint.sourceSpan } : endpoint.kind === 'named' ? { kind: 'named', propertyName: endpoint.propertyName!, row: endpoint.row!, anchors: endpoint.anchors, sourceSpan: endpoint.sourceSpan } : { kind: 'a1', address: endpoint.address!, anchors: endpoint.anchors, sourceSpan: endpoint.sourceSpan }) as [FormulaReferenceEndpoint, FormulaReferenceEndpoint?], sourceSpan: match.sourceSpan }; }
function targetSheet(qualifier: FormulaQualifier, current: SheetId): SheetId | undefined { return qualifier.kind === 'broken' ? undefined : qualifier.kind === 'explicit' ? qualifier.sheetId : current; }
function rawTargetSheet(qualifier: FormulaQualifier, resolver: FormulaReferenceResolver): SheetId | undefined { return qualifier.kind === 'explicit' ? resolver.sheetByQualifier(qualifier.sheetId) : targetSheet(qualifier, resolver.currentSheetId); }
function formatCanonical(coordinate: FormulaCoordinate, anchors: FormulaAxisAnchor): string { return `${anchors.column ? '$' : ''}${coordinate.columnId}[${anchors.row ? '$' : ''}${coordinate.rowId}]`; }
/**
 * Stable IDs admit every non-blank JavaScript string. Encode UTF-16 code units
 * so the parser-owned delimiters cannot occur in a persisted endpoint.
 */
function formatNamedCanonical(propertyId: string, coordinate: FormulaCoordinate, anchors: FormulaAxisAnchor): string { return `${anchors.column ? '$' : ''}~${encodeStableId(propertyId)}~${encodeStableId(coordinate.columnId)}[${anchors.row ? '$' : ''}${encodeStableId(coordinate.rowId)}]`; }
function encodeStableId(value: string): string { return Array.from({ length: value.length }, (_, index) => value.charCodeAt(index).toString(16).padStart(4, '0')).join(''); }
function formatA1(address: CellAddress, anchors: FormulaAxisAnchor): string { return `${anchors.column ? '$' : ''}${columnIndexToLabel(address.columnIndex)}[${anchors.row ? '$' : ''}${address.rowIndex + 1}]`; }
function formatNamed(name: string, address: CellAddress, anchors: FormulaAxisAnchor): string { return `${anchors.column ? '$' : ''}'${name.replace(/'/g, "''")}'[${anchors.row ? '$' : ''}${address.rowIndex + 1}]`; }
/** Applies one copy delta while preserving anchors independently on each axis. */
function translateCopyAddress(address: CellAddress, anchors: FormulaAxisAnchor, source: CellAddress, destination: CellAddress): CellAddress {
  return {
    columnIndex: anchors.column ? address.columnIndex : address.columnIndex + destination.columnIndex - source.columnIndex,
    rowIndex: anchors.row ? address.rowIndex : address.rowIndex + destination.rowIndex - source.rowIndex,
  };
}
function displaySpan(sourceSpan: FormulaSourceSpan, edits: readonly Edit[]): FormulaSourceSpan {
  const changeBefore = edits.filter((edit) => edit.end <= sourceSpan.start)
    .reduce((total, edit) => total + edit.value.length - (edit.end - edit.start), 0);
  const changeWithin = edits.filter((edit) => edit.start >= sourceSpan.start && edit.end <= sourceSpan.end)
    .reduce((total, edit) => total + edit.value.length - (edit.end - edit.start), 0);
  return { start: sourceSpan.start + changeBefore, end: sourceSpan.end + changeBefore + changeWithin };
}
function applyEdits(raw: string, edits: Edit[]): string { return [...edits].sort((a, b) => b.start - a.start).reduce((result, edit) => result.slice(0, edit.start) + edit.value + result.slice(edit.end), raw); }
