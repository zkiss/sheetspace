import {
  cellKey,
  parseA1Address,
  parseA1Range,
  type CellAddress,
  type CellKey,
  type CellRange,
} from './cellAddress';
import {
  formulaSheetReferences,
  formatSheetReferenceToken,
  parseFormula as parseFormulaSyntax,
  replaceFormulaQualifiers,
  type FormulaParseResult,
} from './formulaSyntax';
import {
  formulaRawToCanonical,
  formulaRawToDisplay,
  formulaReferenceTokens,
  workbookFormulaReferenceResolver,
} from './formulaReference';

export {
  cellKey,
  columnIndexToLabel,
  columnLabelToIndex,
  expandRange,
  isAddressWithinBounds,
  parseA1Address,
  parseA1Range,
} from './cellAddress';
export type { CellAddress, CellKey, CellRange } from './cellAddress';
export { formatSheetReferenceToken } from './formulaSyntax';
export {
  copyCanonicalFormula,
  formulaRawToCanonical,
  formulaRawToDisplay,
  formulaRawToDisplayProjection,
  formulaReferenceTokens,
  moveCanonicalFormula,
  workbookFormulaReferenceResolver,
} from './formulaReference';
export type {
  FormulaAxisAnchor,
  FormulaCopyContext,
  FormulaCoordinate,
  FormulaDisplayProjection,
  FormulaQualifier,
  FormulaReferenceEndpoint,
  FormulaReferenceResolver,
  FormulaReferenceToken,
  FormulaTransformResult,
} from './formulaReference';
export type {
  BinaryFormula,
  FormulaErrorCode,
  FormulaExpression,
  FormulaLiteral,
  FormulaParseResult,
  FormulaReference,
  FormulaSourceSpan,
  FunctionFormula,
  GroupFormula,
  UnaryFormula,
} from './formulaSyntax';
export { evaluateFormulaCells } from './formulaEvaluator';
export type { FormulaEvaluationObserver } from './formulaEvaluator';
export {
  classifyCellValue,
  displayFormulaValue,
  formulaCollectionValues,
  formulaErrorValue,
  formulaScalarValue,
} from './formulaValue';
export type {
  FormulaDisplayResult,
  FormulaEvaluationSnapshot,
  FormulaRangeValue,
  FormulaScalarValue,
  FormulaValue,
} from './formulaValue';

export const WORKBOOK_SCHEMA_VERSION = 1;
export const DEFAULT_SHEET_FRAME_SIZE: SheetFrameSize = { width: 240, height: 160 };

export type SheetId = string;
export type RowId = string;
export type ColumnId = string;
export type CellIdentityKey = string;

export type WorkbookManifest = {
  version: typeof WORKBOOK_SCHEMA_VERSION;
  revision: number;
  sheetIds: SheetId[];
};

export type Workbook = {
  manifest: WorkbookManifest;
  documents: Record<SheetId, SheetDocument>;
};

export type SheetDocument = {
  id: SheetId;
  revision: number;
  name: string;
  frame: FrameState;
  content: TabularContent;
};

export type FrameState = {
  position: WorkspacePosition;
  size: SheetFrameSize;
  zIndex: number;
};

export type TabularContent = {
  kind: 'tabular';
  rows: RowId[];
  columns: ColumnId[];
  cells: Record<CellIdentityKey, string>;
};

export type StableCellIdentity = { rowId: RowId; columnId: ColumnId };
export type StableCellRange = { start: StableCellIdentity; end: StableCellIdentity };

export type WorkspacePosition = { x: number; y: number };
export type SheetFrameSize = { width: number; height: number };
export type SheetFrameProjection = Pick<SheetDocument, 'id' | 'name'> & FrameState;
export type SheetTabularProjection = Pick<SheetDocument, 'id' | 'name' | 'revision'> & TabularContent;

export type NamedCellReference = CellAddress & { sheetName?: string };
export type NamedRangeReference = CellRange & { sheetName?: string };
export type ValidationResult = { ok: true; name: string } | { ok: false; reason: 'empty' | 'duplicate' };
export type MutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'empty' | 'duplicate' | 'unknown-sheet' };
export type SheetZOrderDirection = 'up' | 'down' | 'top' | 'bottom';
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'invalid-format' | 'out-of-bounds' | 'unknown-sheet' };

const CELL_ID_SEPARATOR = '\u0000';
const a1CellsCache = new WeakMap<TabularContent, Readonly<Record<CellKey, string>>>();

export function cellIdentityKey(identity: StableCellIdentity): CellIdentityKey {
  return `${identity.rowId}${CELL_ID_SEPARATOR}${identity.columnId}`;
}

export function cellIdentityFromKey(key: CellIdentityKey): StableCellIdentity | undefined {
  const separator = key.indexOf(CELL_ID_SEPARATOR);
  if (separator < 1 || separator === key.length - 1) return undefined;
  return { rowId: key.slice(0, separator), columnId: key.slice(separator + 1) };
}

export function sheetBounds(sheet: SheetDocument | TabularContent) {
  const content = 'content' in sheet ? sheet.content : sheet;
  return { rowCount: content.rows.length, columnCount: content.columns.length };
}

export function cellIdentityAt(
  content: TabularContent,
  address: CellAddress | CellKey,
): StableCellIdentity | undefined {
  const resolved = typeof address === 'string' ? parseA1Address(address, sheetBounds(content)) : { ok: true as const, value: address };
  if (!resolved.ok) return undefined;
  const rowId = content.rows[resolved.value.rowIndex];
  const columnId = content.columns[resolved.value.columnIndex];
  return rowId === undefined || columnId === undefined ? undefined : { rowId, columnId };
}

export function cellAddressOf(content: TabularContent, identity: StableCellIdentity): CellAddress | undefined {
  const rowIndex = content.rows.indexOf(identity.rowId);
  const columnIndex = content.columns.indexOf(identity.columnId);
  return rowIndex < 0 || columnIndex < 0 ? undefined : { rowIndex, columnIndex };
}

export function stableRangeAt(content: TabularContent, range: CellRange): StableCellRange | undefined {
  const start = cellIdentityAt(content, range.start);
  const end = cellIdentityAt(content, range.end);
  return start && end ? { start, end } : undefined;
}

export function addressRangeOf(content: TabularContent, range: StableCellRange): CellRange | undefined {
  const start = cellAddressOf(content, range.start);
  const end = cellAddressOf(content, range.end);
  return start && end ? { start, end } : undefined;
}

export function cellRawContent(
  sheet: SheetDocument | SheetTabularProjection,
  address: CellAddress | CellKey,
): string | undefined {
  const content = 'content' in sheet ? sheet.content : sheet;
  const identity = cellIdentityAt(content, address);
  return identity ? content.cells[cellIdentityKey(identity)] : undefined;
}

export function tabularCellsByA1(content: TabularContent): Readonly<Record<CellKey, string>> {
  const cached = a1CellsCache.get(content);
  if (cached) return cached;
  const cells: Record<CellKey, string> = {};
  for (const [identityKey, raw] of Object.entries(content.cells)) {
    const identity = cellIdentityFromKey(identityKey);
    const address = identity && cellAddressOf(content, identity);
    if (address) cells[cellKey(address)] = raw;
  }
  a1CellsCache.set(content, cells);
  return cells;
}

export function sheetsInOrder(workbook: Workbook): SheetDocument[] {
  return workbook.manifest.sheetIds.flatMap((id) => workbook.documents[id] ? [workbook.documents[id]] : []);
}

export function findSheetById(workbook: Workbook, sheetId: SheetId): SheetDocument | undefined {
  return workbook.documents[sheetId];
}

export function frameProjection(sheet: SheetDocument): SheetFrameProjection {
  return { id: sheet.id, name: sheet.name, ...sheet.frame };
}

export function tabularProjection(sheet: SheetDocument): SheetTabularProjection {
  return { id: sheet.id, name: sheet.name, revision: sheet.revision, ...sheet.content };
}

export function createEmptyWorkbook(): Workbook {
  return { manifest: { version: WORKBOOK_SCHEMA_VERSION, revision: 0, sheetIds: [] }, documents: {} };
}

export function moveSheetZOrder(workbook: Workbook, sheetId: string, direction: SheetZOrderDirection): MutationResult<Workbook> {
  if (!findSheetById(workbook, sheetId)) return { ok: false, reason: 'unknown-sheet' };
  const ordered = [...sheetsInOrder(workbook)].sort((a, b) => a.frame.zIndex - b.frame.zIndex);
  const currentIndex = ordered.findIndex((sheet) => sheet.id === sheetId);
  const targetIndex = direction === 'top' ? ordered.length - 1
    : direction === 'bottom' ? 0
      : direction === 'up' ? Math.min(ordered.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
  if (targetIndex !== currentIndex) {
    const [moved] = ordered.splice(currentIndex, 1);
    ordered.splice(targetIndex, 0, moved);
  }
  const zById = new Map(ordered.map((sheet, index) => [sheet.id, index + 1]));
  return {
    ok: true,
    value: updateDocuments(workbook, (sheet) => {
      const zIndex = zById.get(sheet.id) ?? sheet.frame.zIndex;
      return zIndex === sheet.frame.zIndex ? sheet : { ...sheet, frame: { ...sheet.frame, zIndex } };
    }),
  };
}

export function normalizeSheetZOrder(workbook: Workbook): Workbook {
  const ordered = [...sheetsInOrder(workbook)].sort((a, b) => a.frame.zIndex - b.frame.zIndex);
  const zById = new Map(ordered.map((sheet, index) => [sheet.id, index + 1]));
  return updateDocuments(workbook, (sheet) => {
    const zIndex = zById.get(sheet.id) ?? sheet.frame.zIndex;
    return zIndex === sheet.frame.zIndex ? sheet : { ...sheet, frame: { ...sheet.frame, zIndex } };
  });
}

function updateDocuments(workbook: Workbook, update: (sheet: SheetDocument) => SheetDocument): Workbook {
  let changed = false;
  const documents = Object.fromEntries(Object.entries(workbook.documents).map(([id, sheet]) => {
    const next = update(sheet);
    changed ||= next !== sheet;
    return [id, next];
  }));
  return changed ? { ...workbook, documents } : workbook;
}

export function validateSheetName(name: string, existingSheets: Pick<SheetDocument, 'id' | 'name'>[], currentSheetId?: string): ValidationResult {
  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, reason: 'empty' };
  return existingSheets.some((sheet) => sheet.id !== currentSheetId && sheet.name === trimmedName)
    ? { ok: false, reason: 'duplicate' }
    : { ok: true, name: trimmedName };
}

export function renameSheet(workbook: Workbook, sheetId: string, nextName: string): MutationResult<Workbook> {
  const sheet = findSheetById(workbook, sheetId);
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  const validation = validateSheetName(nextName, sheetsInOrder(workbook), sheetId);
  if (!validation.ok) return validation;
  return { ok: true, value: { ...workbook, documents: { ...workbook.documents, [sheetId]: { ...sheet, name: validation.name } } } };
}

export function commitCellRawContent(workbook: Workbook, sheetId: string, key: CellKey, raw: string): Workbook {
  const sheet = findSheetById(workbook, sheetId);
  const identity = sheet && cellIdentityAt(sheet.content, key);
  if (!sheet || !identity) return workbook;
  const canonicalRaw = formulaRawForStorage(raw, workbook, sheet.id);
  const identityKey = cellIdentityKey(identity);
  const current = sheet.content.cells[identityKey];
  if ((raw.length === 0 && current === undefined) || (raw.length > 0 && current === canonicalRaw)) return workbook;
  const cells = { ...sheet.content.cells };
  if (raw.length === 0) delete cells[identityKey]; else cells[identityKey] = canonicalRaw;
  return {
    ...workbook,
    documents: {
      ...workbook.documents,
      [sheetId]: { ...sheet, content: { ...sheet.content, cells } },
    },
  };
}

export function findSheetByName(workbook: Workbook, sheetName: string): ParseResult<SheetDocument> {
  const sheet = sheetsInOrder(workbook).find((candidate) => candidate.name === sheetName);
  return sheet ? { ok: true, value: sheet } : { ok: false, reason: 'unknown-sheet' };
}

export function appendRow(sheet: SheetDocument, rowId: RowId): SheetDocument {
  return { ...sheet, content: { ...sheet.content, rows: [...sheet.content.rows, rowId] } };
}

export function appendColumn(sheet: SheetDocument, columnId: ColumnId): SheetDocument {
  return { ...sheet, content: { ...sheet.content, columns: [...sheet.content.columns, columnId] } };
}

export function parseNamedA1Address(input: string, workbook: Workbook, defaultSheet?: SheetDocument): ParseResult<NamedCellReference> {
  const reference = splitSheetReference(input);
  if (!reference.ok) return reference;
  const sheet = resolveReferenceSheet(reference.value.sheetName, workbook, defaultSheet);
  if (!sheet.ok) return sheet;
  const address = parseA1Address(reference.value.reference, sheetBounds(sheet.value));
  return address.ok ? { ok: true, value: { ...address.value, sheetName: reference.value.sheetName } } : address;
}

export function parseNamedA1Range(input: string, workbook: Workbook, defaultSheet?: SheetDocument): ParseResult<NamedRangeReference> {
  const reference = splitSheetReference(input);
  if (!reference.ok) return reference;
  const sheet = resolveReferenceSheet(reference.value.sheetName, workbook, defaultSheet);
  if (!sheet.ok) return sheet;
  const range = parseA1Range(reference.value.reference, sheetBounds(sheet.value));
  return range.ok ? { ok: true, value: { ...range.value, sheetName: reference.value.sheetName } } : range;
}

export function parseFormula(raw: string, _workbook: Workbook, _defaultSheet?: SheetDocument): FormulaParseResult {
  return parseFormulaSyntax(raw);
}

function resolveReferenceSheet(sheetName: string | undefined, workbook: Workbook, defaultSheet?: SheetDocument): ParseResult<SheetDocument> {
  if (!sheetName) return defaultSheet ? { ok: true, value: defaultSheet } : { ok: false, reason: 'unknown-sheet' };
  return findSheetByName(workbook, sheetName);
}

export function formulaRawForStorage(raw: string, workbook: Workbook, currentSheetId?: SheetId): string {
  if (currentSheetId) {
    return formulaRawToCanonical(raw, workbookFormulaReferenceResolver(workbook, currentSheetId));
  }
  return replaceFormulaQualifiers(raw, (reference) => {
    if (reference === '#REF') return reference;
    const sheetId = sheetsInOrder(workbook).find((sheet) => sheet.name === reference || sheet.id === reference)?.id;
    return sheetId ? formatSheetReferenceToken(sheetId) : '#REF';
  });
}

export function formulaRawForDisplay(raw: string, workbook: Workbook, currentSheetId?: SheetId): string {
  if (currentSheetId && formulaReferenceTokens(raw).some((reference) =>
    reference.endpoints.some((endpoint) => endpoint?.kind === 'canonical'),
  )) {
    return formulaRawToDisplay(raw, workbookFormulaReferenceResolver(workbook, currentSheetId));
  }
  return replaceFormulaQualifiers(raw, (sheetReference) => {
    const sheet = findSheetById(workbook, sheetReference);
    return sheet ? formatSheetReferenceToken(sheet.name) : '#REF';
  });
}

export function formulaSheetReferenceIds(raw: string): string[] {
  return formulaSheetReferences(raw).filter((sheetId) => sheetId !== '#REF');
}

function splitSheetReference(input: string): ParseResult<{ sheetName?: string; reference: string }> {
  const trimmed = input.trim();
  if (trimmed.startsWith("'")) {
    const closing = trimmed.indexOf("'!");
    return closing <= 1
      ? { ok: false, reason: 'invalid-format' }
      : { ok: true, value: { sheetName: trimmed.slice(1, closing), reference: trimmed.slice(closing + 2) } };
  }
  const separator = trimmed.indexOf('!');
  if (separator === -1) return { ok: true, value: { reference: trimmed } };
  if (separator === 0 || separator === trimmed.length - 1) return { ok: false, reason: 'invalid-format' };
  return { ok: true, value: { sheetName: trimmed.slice(0, separator).trim(), reference: trimmed.slice(separator + 1) } };
}
