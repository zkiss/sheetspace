import { columnIndexToLabel, type CellAddress } from '../core/address';
import type { ColumnId, RowId, SheetId, Workbook } from '../core/model';
import { findSheetById, sheetsInOrder } from '../read/queries';
import { formatPropertyReferenceToken, formatSheetReferenceToken, formulaReferenceLexemes, formulaSheetReferences, mergeFormulaDiagnostics, parseFormulaSyntax, replaceFormulaQualifiers, type FormulaExpression, type FormulaReference, type FormulaReferenceLexeme, type FormulaSyntaxResult } from './syntax';

export type FormulaCoordinate = { columnId: ColumnId; rowId: RowId };
export type FormulaAxisAnchor = { column: boolean; row: boolean };
export type FormulaSourceSpan = { start: number; end: number };
export type FormulaQualifier = { kind: 'unqualified' } | { kind: 'explicit'; sheetId: SheetId; sourceSpan: FormulaSourceSpan } | { kind: 'broken'; sourceSpan: FormulaSourceSpan };
export type FormulaReferenceEndpoint = { anchors: FormulaAxisAnchor; sourceSpan: FormulaSourceSpan } & ({ kind: 'canonical'; coordinate: FormulaCoordinate; propertyId?: string } | { kind: 'a1'; address: CellAddress } | { kind: 'named'; propertyName: string; row: number });
export type FormulaReferenceToken = { kind: 'cell' | 'range'; qualifier: FormulaQualifier; endpoints: readonly [FormulaReferenceEndpoint, FormulaReferenceEndpoint?]; sourceSpan: FormulaSourceSpan };
export type FormulaReferenceResolver = { currentSheetId: SheetId; sheetByQualifier(qualifier: string): SheetId | undefined; displaySheetQualifier?(sheetId: SheetId): string | undefined; coordinateAt(sheetId: SheetId, address: CellAddress): FormulaCoordinate | undefined; addressOf(sheetId: SheetId, coordinate: FormulaCoordinate): CellAddress | undefined; hasNamedColumn?(sheetId: SheetId, name: string): boolean; namedCoordinateAt?(sheetId: SheetId, name: string, row: number): { propertyId: string; coordinate: FormulaCoordinate } | undefined; namedAddressOf?(sheetId: SheetId, propertyId: string, coordinate: FormulaCoordinate): { name: string; address: CellAddress } | undefined; namedAddressAt?(sheetId: SheetId, coordinate: FormulaCoordinate): { propertyId: string; name: string; address: CellAddress } | undefined };
export type FormulaTransformResult = { ok: true; raw: string } | { ok: false; reason: 'unresolved-coordinate' };
export type FormulaCopyContext = { sourceSheetId?: SheetId; destinationSheetId?: SheetId };
export type FormulaDisplayProjection = { raw: string; referenceSpans: readonly FormulaSourceSpan[] };

type Endpoint = { kind: 'a1' | 'canonical' | 'named'; address?: CellAddress; coordinate?: FormulaCoordinate; propertyId?: string; propertyName?: string; row?: number; anchors: FormulaAxisAnchor; sourceSpan: FormulaSourceSpan };
type Match = { sourceSpan: FormulaSourceSpan; qualifier: FormulaQualifier; endpoints: Endpoint[]; canonical: boolean };
type Edit = FormulaSourceSpan & { value: string };

/** Reference recognition is delegated to formulaSyntax, including malformed-formula recovery. */
export function formulaReferenceTokens(raw: string, resolver?: FormulaReferenceResolver): FormulaReferenceToken[] { return lexemeMatches(raw, resolver).map(toToken); }

function namedColumnPredicate(resolver?: FormulaReferenceResolver) {
  return (qualifier: string | undefined, name: string) => {
    const sheetId = qualifier === undefined ? resolver?.currentSheetId : resolver?.sheetByQualifier(qualifier);
    return Boolean(sheetId && resolver?.hasNamedColumn?.(sheetId, name));
  };
}

/**
 * Adds resolver-backed reference diagnostics to the parser's lossless analysis.
 * Syntax recognition remains exclusively owned by formulaSyntax; this only asks
 * the existing resolver for stable named targets and target validity.
 */
export function analyzeFormulaSyntax(raw: string, resolver: FormulaReferenceResolver): FormulaSyntaxResult {
  const analysis = parseFormulaSyntax(raw, { preserveUnknownFunctions: true, isNamedColumn: namedColumnPredicate(resolver) });
  const diagnostics = analysis.referenceLexemes.map(matchFromLexeme)
    .filter((match) => !referenceMatchResolves(match, resolver))
    .map((match) => ({ kind: 'reference' as const, code: '#REF!' as const, sourceSpan: match.sourceSpan }));
  const references = analysis.references.map((reference) => resolveNamedReference(reference, resolver));
  const resolvedByStart = new Map(references.map((reference) => [reference.sourceSpan.start, reference]));
  return {
    ...analysis,
    result: analysis.result.kind === 'formula'
      ? { ...analysis.result, expression: resolveExpressionReferences(analysis.result.expression, resolvedByStart) }
      : analysis.result,
    references,
    diagnostics: mergeFormulaDiagnostics(analysis.diagnostics, diagnostics),
  };
}

function resolveNamedReference(reference: FormulaReference, resolver: FormulaReferenceResolver): FormulaReference {
  if (reference.kind !== 'named') return reference;
  const sheetId = reference.sheetId === undefined ? resolver.currentSheetId : resolver.sheetByQualifier(reference.sheetId);
  if (!sheetId) return reference;
  const resolve = (endpoint: typeof reference.endpoint) => resolver.namedCoordinateAt?.(sheetId, endpoint.propertyName, endpoint.row);
  const start = resolve(reference.endpoint);
  const end = reference.end && resolve(reference.end);
  if (!start || (reference.end && !end)) return reference;
  return {
    kind: 'canonical',
    ...(reference.sheetId === undefined ? {} : { sheetId }),
    coordinate: start.coordinate,
    propertyId: start.propertyId,
    ...(end ? { range: { start: start.coordinate, end: end.coordinate, startPropertyId: start.propertyId, endPropertyId: end.propertyId } } : {}),
    sourceSpan: reference.sourceSpan,
    ...(reference.sheetReferenceSpan ? { sheetReferenceSpan: reference.sheetReferenceSpan } : {}),
  };
}

function resolveExpressionReferences(expression: FormulaExpression, references: ReadonlyMap<number, FormulaReference>): FormulaExpression {
  switch (expression.kind) {
    case 'cell':
    case 'range':
    case 'canonical':
    case 'named':
      return references.get(expression.sourceSpan.start)!;
    case 'group':
      return { ...expression, expression: resolveExpressionReferences(expression.expression, references) };
    case 'unary':
      return { ...expression, operand: resolveExpressionReferences(expression.operand, references) };
    case 'binary':
      return { ...expression, left: resolveExpressionReferences(expression.left, references), right: resolveExpressionReferences(expression.right, references) };
    case 'function':
      return { ...expression, arguments: expression.arguments.map((argument) => resolveExpressionReferences(argument, references)) };
    default:
      return expression;
  }
}

export function formulaRawToCanonical(raw: string, resolver: FormulaReferenceResolver): string {
  const edits: Edit[] = [];
  for (const match of rawMatches(raw, resolver)) {
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
  const edits = formulaReferenceTokens(raw).flatMap((reference): Edit[] => {
    if (reference.qualifier.kind !== 'explicit') return [];
    const qualifier = reference.qualifier;
    const sheet = findSheetById(workbook, qualifier.sheetId)
      ?? (reference.endpoints[0].kind === 'named' ? sheetsInOrder(workbook).find((sheet) => sheet.name === qualifier.sheetId) : undefined);
    return [{ ...qualifier.sourceSpan, value: sheet ? formatSheetReferenceToken(sheet.name) : '#REF' }];
  });
  return applyEdits(raw, edits);
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
    const translated = [];
    for (const endpoint of match.endpoints) {
      const address = endpoint.coordinate && resolver.addressOf(originalSheet, endpoint.coordinate);
      if (!address) return { ok: false, reason: 'unresolved-coordinate' };
      const coordinate = resolver.coordinateAt(resultSheet, translateCopyAddress(address, endpoint.anchors, origin, target));
      if (!coordinate) return { ok: false, reason: 'unresolved-coordinate' };
      if (endpoint.propertyId && !resolver.namedAddressOf?.(originalSheet, endpoint.propertyId, endpoint.coordinate!)) return { ok: false, reason: 'unresolved-coordinate' };
      translated.push({ endpoint, coordinate, named: endpoint.propertyId && resolver.namedAddressAt?.(resultSheet, coordinate) });
    }
    const useNamedRange = translated.length === 2 && translated.every(({ named }) => named);
    for (const { endpoint, coordinate, named } of translated) {
      const useNamedEndpoint = named && (translated.length === 1 || useNamedRange);
      edits.push({ ...endpoint.sourceSpan, value: useNamedEndpoint ? formatNamedCanonical(named.propertyId, coordinate, endpoint.anchors) : formatCanonical(coordinate, endpoint.anchors) });
    }
  }
  return { ok: true, raw: applyEdits(raw, edits) };
}

export type FormulaMoveTarget = { sheetId: SheetId; cell: FormulaCoordinate };
export type FormulaMoveMapping = { source: FormulaMoveTarget; destination: FormulaMoveTarget };
export type FormulaMoveResult = { ok: true; raw: string } | { ok: false; reason: 'unrepresentable-range' };

export function moveCanonicalFormula(raw: string, resolver?: FormulaReferenceResolver, destinationSheetId?: SheetId, mappings: readonly FormulaMoveMapping[] = []): FormulaMoveResult {
  if (!resolver) return { ok: true, raw };
  const key = (target: FormulaMoveTarget) => JSON.stringify([target.sheetId, target.cell.columnId, target.cell.rowId]);
  const mapped = new Map(mappings.map(({ source, destination }) => [key(source), destination]));
  const edits: Edit[] = [];
  for (const match of canonicalMatches(raw)) {
    const sheetId = targetSheet(match.qualifier, resolver.currentSheetId);
    if (!sheetId || !referenceMatchResolves(match, resolver)) continue;
    const addresses = match.endpoints.map((endpoint) => resolver.addressOf(sheetId, endpoint.coordinate!)!);
    const first = addresses[0]!, last = addresses[addresses.length - 1]!;
    const targets: FormulaMoveTarget[] = [];
    let changed = false;
    for (let row = Math.min(first.rowIndex, last.rowIndex); row <= Math.max(first.rowIndex, last.rowIndex); row += 1) {
      for (let column = Math.min(first.columnIndex, last.columnIndex); column <= Math.max(first.columnIndex, last.columnIndex); column += 1) {
        const coordinate = resolver.coordinateAt(sheetId, { rowIndex: row, columnIndex: column });
        if (!coordinate) continue;
        const original = { sheetId, cell: coordinate };
        const target = mapped.get(key(original));
        changed ||= Boolean(target);
        targets.push(target ?? original);
      }
    }
    const finalSheet = targets[0]?.sheetId;
    if (!finalSheet) continue;
    if (changed && targets.some((target) => target.sheetId !== finalSheet)) return { ok: false, reason: 'unrepresentable-range' };
    const targetAddresses = targets.map((target) => resolver.addressOf(target.sheetId, target.cell)!);
    let minRow = Infinity, maxRow = -Infinity, minColumn = Infinity, maxColumn = -Infinity;
    for (const address of targetAddresses) {
      minRow = Math.min(minRow, address.rowIndex); maxRow = Math.max(maxRow, address.rowIndex);
      minColumn = Math.min(minColumn, address.columnIndex); maxColumn = Math.max(maxColumn, address.columnIndex);
    }
    if (changed && (maxRow - minRow + 1) * (maxColumn - minColumn + 1) !== new Set(targets.map(key)).size) return { ok: false, reason: 'unrepresentable-range' };
    if (changed) {
      const ends = match.endpoints.length === 1 ? [targetAddresses[0]!] : [
        { rowIndex: first.rowIndex <= last.rowIndex ? minRow : maxRow, columnIndex: first.columnIndex <= last.columnIndex ? minColumn : maxColumn },
        { rowIndex: first.rowIndex <= last.rowIndex ? maxRow : minRow, columnIndex: first.columnIndex <= last.columnIndex ? maxColumn : minColumn },
      ];
      const coordinates = ends.map((address) => resolver.coordinateAt(finalSheet, address)!);
      const named = coordinates.map((coordinate) => resolver.namedAddressAt?.(finalSheet, coordinate));
      match.endpoints.forEach((endpoint, index) => {
        const property = endpoint.propertyId && named[index] && (ends.length === 1 || named.every(Boolean)) ? named[index]!.propertyId : undefined;
        edits.push({ ...endpoint.sourceSpan, value: formatCanonicalFormulaEndpoint(coordinates[index]!, endpoint.anchors, property) });
      });
    }
    if (match.qualifier.kind === 'explicit' && finalSheet !== sheetId) edits.push({ ...match.qualifier.sourceSpan, value: finalSheet });
    if (match.qualifier.kind === 'unqualified' && finalSheet !== (destinationSheetId ?? resolver.currentSheetId)) {
      edits.push({ start: match.endpoints[0]!.sourceSpan.start, end: match.endpoints[0]!.sourceSpan.start, value: `${finalSheet}!` });
    }
  }
  return { ok: true, raw: applyEdits(raw, edits) };
}

export function workbookFormulaReferenceResolver(workbook: Workbook, currentSheetId: SheetId): FormulaReferenceResolver {
  const sheet = (id: SheetId) => workbook.documents[id];
  const namedAddressOf = (sheetId: SheetId, propertyId: string, coordinate: FormulaCoordinate) => { const document = sheet(sheetId); const model = document?.modelId ? workbook.dataModels?.[document.modelId] : undefined; const property = model?.columns.find((column) => column.id === propertyId); if (!document || !property || document.modelColumnBindings?.[propertyId] !== coordinate.columnId) return undefined; const rowIndex = document.content.rows.indexOf(coordinate.rowId); const columnIndex = document.content.columns.indexOf(coordinate.columnId); return rowIndex < 0 || columnIndex < 0 ? undefined : { name: property.name, address: { rowIndex, columnIndex } }; };
  return { currentSheetId,
    sheetByQualifier: (qualifier) => Object.values(workbook.documents).find((entry) => entry.id === qualifier || entry.name === qualifier)?.id,
    displaySheetQualifier: (sheetId) => { const name = sheet(sheetId)?.name; return name && (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`); },
    coordinateAt: (sheetId, address) => { const content = sheet(sheetId)?.content; const rowId = content?.rows[address.rowIndex]; const columnId = content?.columns[address.columnIndex]; return rowId && columnId ? { rowId, columnId } : undefined; },
    addressOf: (sheetId, coordinate) => { const content = sheet(sheetId)?.content; if (!content) return undefined; const rowIndex = content.rows.indexOf(coordinate.rowId); const columnIndex = content.columns.indexOf(coordinate.columnId); return rowIndex < 0 || columnIndex < 0 ? undefined : { rowIndex, columnIndex }; },
    hasNamedColumn: (sheetId, name) => {
      const document = sheet(sheetId);
      const model = document?.modelId ? workbook.dataModels?.[document.modelId] : undefined;
      return Boolean(model?.columns.some((property) => property.name === name && document?.modelColumnBindings?.[property.id]));
    },
    namedCoordinateAt: (sheetId, name, row) => { const document = sheet(sheetId); const model = document?.modelId ? workbook.dataModels?.[document.modelId] : undefined; const property = model?.columns.find((column) => column.name === name); const columnId = property && document?.modelColumnBindings?.[property.id]; const rowId = document?.content.rows[row - 1]; return property && columnId && rowId && document.content.columns.includes(columnId) ? { propertyId: property.id, coordinate: { columnId, rowId } } : undefined; },
    namedAddressOf,
    namedAddressAt: (sheetId, coordinate) => { const document = sheet(sheetId); const model = document?.modelId ? workbook.dataModels?.[document.modelId] : undefined; const property = model?.columns.find((column) => document?.modelColumnBindings?.[column.id] === coordinate.columnId); const named = property && namedAddressOf(sheetId, property.id, coordinate); return named && property ? { propertyId: property.id, ...named } : undefined; },
  };
}

function rawMatches(raw: string, resolver?: FormulaReferenceResolver): Match[] { return lexemeMatches(raw, resolver).filter((match) => !match.canonical); }
function lexemeMatches(raw: string, resolver?: FormulaReferenceResolver): Match[] { return formulaReferenceLexemes(raw, namedColumnPredicate(resolver)).map(matchFromLexeme); }
function referenceMatchResolves(match: Match, resolver: FormulaReferenceResolver): boolean {
  const sheetId = match.canonical
    ? targetSheet(match.qualifier, resolver.currentSheetId)
    : rawTargetSheet(match.qualifier, resolver);
  if (!sheetId) return false;
  return match.endpoints.every((endpoint) => {
    if (endpoint.kind === 'a1') return Boolean(resolver.coordinateAt(sheetId, endpoint.address!));
    if (endpoint.kind === 'named') return Boolean(resolver.namedCoordinateAt?.(sheetId, endpoint.propertyName!, endpoint.row!));
    if (!endpoint.coordinate || !resolver.addressOf(sheetId, endpoint.coordinate)) return false;
    return !endpoint.propertyId || Boolean(resolver.namedAddressOf?.(sheetId, endpoint.propertyId, endpoint.coordinate));
  });
}
function matchFromLexeme(lexeme: FormulaReferenceLexeme): Match {
  const qualifier: FormulaQualifier = !lexeme.qualifier ? { kind: 'unqualified' } : lexeme.qualifier.broken ? { kind: 'broken', sourceSpan: lexeme.qualifier.sourceSpan } : { kind: 'explicit', sheetId: lexeme.qualifier.value, sourceSpan: lexeme.qualifier.sourceSpan };
  const endpoints = lexeme.endpoints.map((endpoint): Endpoint => {
    const base = { anchors: endpoint.anchors, sourceSpan: endpoint.sourceSpan };
    if (endpoint.kind === 'a1') return { ...base, kind: 'a1', address: endpoint.value };
    if (endpoint.kind === 'named') return { ...base, kind: 'named', ...endpoint.value };
    return { ...base, kind: 'canonical', coordinate: { columnId: endpoint.value.columnId, rowId: endpoint.value.rowId }, ...(endpoint.kind === 'stored-named' ? { propertyId: endpoint.value.propertyId } : {}) };
  });
  return { sourceSpan: lexeme.sourceSpan, qualifier, endpoints, canonical: lexeme.endpoints[0]?.kind === 'canonical' || lexeme.endpoints[0]?.kind === 'stored-named' };
}
function canonicalMatches(raw: string): Match[] { return lexemeMatches(raw).filter((match) => match.canonical); }
function toToken(match: Match): FormulaReferenceToken { return { kind: match.endpoints.length === 2 ? 'range' : 'cell', qualifier: match.qualifier, endpoints: match.endpoints.map((endpoint) => endpoint.kind === 'canonical' ? { kind: 'canonical', coordinate: endpoint.coordinate!, ...(endpoint.propertyId ? { propertyId: endpoint.propertyId } : {}), anchors: endpoint.anchors, sourceSpan: endpoint.sourceSpan } : endpoint.kind === 'named' ? { kind: 'named', propertyName: endpoint.propertyName!, row: endpoint.row!, anchors: endpoint.anchors, sourceSpan: endpoint.sourceSpan } : { kind: 'a1', address: endpoint.address!, anchors: endpoint.anchors, sourceSpan: endpoint.sourceSpan }) as [FormulaReferenceEndpoint, FormulaReferenceEndpoint?], sourceSpan: match.sourceSpan }; }
function targetSheet(qualifier: FormulaQualifier, current: SheetId): SheetId | undefined { return qualifier.kind === 'broken' ? undefined : qualifier.kind === 'explicit' ? qualifier.sheetId : current; }
function rawTargetSheet(qualifier: FormulaQualifier, resolver: FormulaReferenceResolver): SheetId | undefined { return qualifier.kind === 'explicit' ? resolver.sheetByQualifier(qualifier.sheetId) : targetSheet(qualifier, resolver.currentSheetId); }
export function formatCanonicalFormulaEndpoint(coordinate: FormulaCoordinate, anchors: FormulaAxisAnchor, propertyId?: string): string {
  return propertyId === undefined ? formatCanonical(coordinate, anchors) : formatNamedCanonical(propertyId, coordinate, anchors);
}
function formatCanonical(coordinate: FormulaCoordinate, anchors: FormulaAxisAnchor): string { return `${anchors.column ? '$' : ''}${coordinate.columnId}[${anchors.row ? '$' : ''}${coordinate.rowId}]`; }
/**
 * Stable IDs admit every non-blank JavaScript string. Encode UTF-16 code units
 * so the parser-owned delimiters cannot occur in a persisted endpoint.
 */
function formatNamedCanonical(propertyId: string, coordinate: FormulaCoordinate, anchors: FormulaAxisAnchor): string { return `${anchors.column ? '$' : ''}~${encodeStableId(propertyId)}~${encodeStableId(coordinate.columnId)}[${anchors.row ? '$' : ''}${encodeStableId(coordinate.rowId)}]`; }
function encodeStableId(value: string): string { return Array.from({ length: value.length }, (_, index) => value.charCodeAt(index).toString(16).padStart(4, '0')).join(''); }
function formatA1(address: CellAddress, anchors: FormulaAxisAnchor): string { return `${anchors.column ? '$' : ''}${columnIndexToLabel(address.columnIndex)}[${anchors.row ? '$' : ''}${address.rowIndex + 1}]`; }
function formatNamed(name: string, address: CellAddress, anchors: FormulaAxisAnchor): string { return `${anchors.column ? '$' : ''}${formatPropertyReferenceToken(name)}[${anchors.row ? '$' : ''}${address.rowIndex + 1}]`; }
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
