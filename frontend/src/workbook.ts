export const WORKBOOK_SCHEMA_VERSION = 1;
export const DEFAULT_COLUMN_COUNT = 10;
export const DEFAULT_ROW_COUNT = 20;
export const DEFAULT_SHEET_FRAME_SIZE: SheetFrameSize = {
  width: 240,
  height: 160,
};

export type Workbook = {
  version: typeof WORKBOOK_SCHEMA_VERSION;
  sheets: Sheet[];
};

export type Sheet = {
  id: string;
  name: string;
  revision: number;
  position: WorkspacePosition;
  frameSize: SheetFrameSize;
  zIndex: number;
  columnCount: number;
  rowCount: number;
  cells: Record<CellKey, string>;
};

export type WorkspacePosition = {
  x: number;
  y: number;
};

export type SheetFrameSize = {
  width: number;
  height: number;
};

export type CellKey = string;

export type CellAddress = {
  columnIndex: number;
  rowIndex: number;
};

export type CellRange = {
  start: CellAddress;
  end: CellAddress;
};

export type NamedCellReference = CellAddress & {
  sheetName?: string;
};

export type NamedRangeReference = CellRange & {
  sheetName?: string;
};

export type FormulaErrorCode = '#PARSE!' | '#REF!' | '#NAME!' | '#VALUE!' | '#CYCLE!';

export type FormulaSourceSpan = {
  start: number;
  end: number;
};

export type FormulaReference =
  | {
      kind: 'cell';
      sheetId?: string;
      address: CellAddress;
      sourceSpan: FormulaSourceSpan;
      sheetReferenceSpan?: FormulaSourceSpan;
    }
  | {
      kind: 'range';
      sheetId?: string;
      range: CellRange;
      sourceSpan: FormulaSourceSpan;
      sheetReferenceSpan?: FormulaSourceSpan;
    };

export type FormulaLiteral =
  | {
      kind: 'number';
      value: number;
      sourceSpan: FormulaSourceSpan;
    }
  | {
      kind: 'text';
      value: string;
      sourceSpan: FormulaSourceSpan;
    }
  | {
      kind: 'boolean';
      value: boolean;
      sourceSpan: FormulaSourceSpan;
    };

export type GroupFormula = {
  kind: 'group';
  expression: FormulaExpression;
  sourceSpan: FormulaSourceSpan;
};

export type SumFormula = {
  kind: 'sum';
  functionName: 'SUM';
  arguments: FormulaExpression[];
  sourceSpan: FormulaSourceSpan;
};

export type FormulaExpression = FormulaReference | FormulaLiteral | GroupFormula | SumFormula;

export type FormulaParseResult =
  | { kind: 'not-formula'; raw: string }
  | { kind: 'formula'; raw: string; expression: FormulaExpression }
  | { kind: 'error'; raw: string; error: FormulaErrorCode };

export type FormulaDisplayResult =
  | { kind: 'number'; value: number; display: string }
  | { kind: 'error'; error: FormulaErrorCode; display: FormulaErrorCode };

export type FormulaEvaluationSnapshot = Record<string, Record<CellKey, FormulaDisplayResult>>;

export type ValidationResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'duplicate' };

export type MutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'empty' | 'duplicate' | 'unknown-sheet' };

export type SheetZOrderDirection = 'up' | 'down' | 'top' | 'bottom';

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'invalid-format' | 'out-of-bounds' | 'unknown-sheet' };

export function createEmptyWorkbook(): Workbook {
  return {
    version: WORKBOOK_SCHEMA_VERSION,
    sheets: [],
  };
}

export function createSheet(input: {
  id: string;
  name: string;
  existingSheets?: Pick<Sheet, 'id' | 'name' | 'zIndex'>[];
  position?: WorkspacePosition;
  frameSize?: SheetFrameSize;
  zIndex?: number;
}): MutationResult<Sheet> {
  const validation = validateSheetName(input.name, input.existingSheets ?? []);
  if (!validation.ok) {
    return validation;
  }

  return {
    ok: true,
    value: {
      id: input.id,
      name: validation.name,
      revision: 0,
      position: input.position ?? { x: 0, y: 0 },
      frameSize: input.frameSize ?? DEFAULT_SHEET_FRAME_SIZE,
      zIndex: input.zIndex ?? nextSheetZIndex(input.existingSheets ?? []),
      columnCount: DEFAULT_COLUMN_COUNT,
      rowCount: DEFAULT_ROW_COUNT,
      cells: {},
    },
  };
}

export function moveSheetZOrder(
  workbook: Workbook,
  sheetId: string,
  direction: SheetZOrderDirection,
): MutationResult<Workbook> {
  if (!workbook.sheets.some((sheet) => sheet.id === sheetId)) {
    return { ok: false, reason: 'unknown-sheet' };
  }

  const orderedSheets = sheetsByZOrder(workbook.sheets);
  const currentIndex = orderedSheets.findIndex((sheet) => sheet.id === sheetId);
  const targetIndex =
    direction === 'top'
      ? orderedSheets.length - 1
      : direction === 'bottom'
        ? 0
        : direction === 'up'
          ? Math.min(orderedSheets.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);

  if (targetIndex === currentIndex) {
    return { ok: true, value: normalizeSheetZOrder(workbook) };
  }

  const reordered = [...orderedSheets];
  const [movedSheet] = reordered.splice(currentIndex, 1);
  reordered.splice(targetIndex, 0, movedSheet);

  const nextZIndexById = new Map(reordered.map((sheet, index) => [sheet.id, index + 1]));
  return {
    ok: true,
    value: {
      ...workbook,
      sheets: workbook.sheets.map((sheet) => ({
        ...sheet,
        zIndex: nextZIndexById.get(sheet.id) ?? sheet.zIndex,
      })),
    },
  };
}

export function normalizeSheetZOrder(workbook: Workbook): Workbook {
  const orderedSheets = sheetsByZOrder(workbook.sheets);
  const nextZIndexById = new Map(orderedSheets.map((sheet, index) => [sheet.id, index + 1]));

  if (workbook.sheets.every((sheet) => sheet.zIndex === nextZIndexById.get(sheet.id))) {
    return workbook;
  }

  return {
    ...workbook,
    sheets: workbook.sheets.map((sheet) => ({
      ...sheet,
      zIndex: nextZIndexById.get(sheet.id) ?? sheet.zIndex,
    })),
  };
}

function nextSheetZIndex(sheets: Pick<Sheet, 'zIndex'>[]): number {
  return Math.max(0, ...sheets.map((sheet) => sheet.zIndex)) + 1;
}

function sheetsByZOrder(sheets: Sheet[]): Sheet[] {
  return [...sheets].sort((first, second) => first.zIndex - second.zIndex);
}

export function validateSheetName(
  name: string,
  existingSheets: Pick<Sheet, 'id' | 'name'>[],
  currentSheetId?: string,
): ValidationResult {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  const duplicate = existingSheets.some(
    (sheet) => sheet.id !== currentSheetId && sheet.name === trimmedName,
  );
  if (duplicate) {
    return { ok: false, reason: 'duplicate' };
  }

  return { ok: true, name: trimmedName };
}

export function renameSheet(workbook: Workbook, sheetId: string, nextName: string): MutationResult<Workbook> {
  const validation = validateSheetName(nextName, workbook.sheets, sheetId);
  if (!validation.ok) {
    return validation;
  }

  if (!workbook.sheets.some((sheet) => sheet.id === sheetId)) {
    return { ok: false, reason: 'unknown-sheet' };
  }

  return {
    ok: true,
    value: {
      ...workbook,
      sheets: workbook.sheets.map((sheet) =>
        sheet.id === sheetId ? { ...sheet, name: validation.name } : sheet,
      ),
    },
  };
}

export function commitCellRawContent(
  workbook: Workbook,
  sheetId: string,
  key: CellKey,
  raw: string,
): Workbook {
  const canonicalRaw = formulaRawForStorage(raw, workbook);
  let changed = false;
  const sheets = workbook.sheets.map((sheet) => {
    if (sheet.id !== sheetId) {
      return sheet;
    }

    const existingCell = sheet.cells[key];
    if (raw.length === 0) {
      if (existingCell === undefined) {
        return sheet;
      }

      changed = true;
      const cells = { ...sheet.cells };
      delete cells[key];

      return {
        ...sheet,
        cells,
      };
    }

    if (existingCell === canonicalRaw) {
      return sheet;
    }

    changed = true;
    const cells = { ...sheet.cells };
    cells[key] = canonicalRaw;

    return {
      ...sheet,
      cells,
    };
  });

  return changed ? { ...workbook, sheets } : workbook;
}

export function findSheetByName(workbook: Workbook, sheetName: string): ParseResult<Sheet> {
  const sheet = workbook.sheets.find((candidate) => candidate.name === sheetName);
  if (!sheet) {
    return { ok: false, reason: 'unknown-sheet' };
  }

  return { ok: true, value: sheet };
}

export function appendRow(sheet: Sheet): Sheet {
  return {
    ...sheet,
    rowCount: sheet.rowCount + 1,
  };
}

export function appendColumn(sheet: Sheet): Sheet {
  return {
    ...sheet,
    columnCount: sheet.columnCount + 1,
  };
}

export function columnIndexToLabel(columnIndex: number): string {
  if (!Number.isInteger(columnIndex) || columnIndex < 0) {
    throw new RangeError('Column index must be a non-negative integer.');
  }

  let remaining = columnIndex + 1;
  let label = '';
  while (remaining > 0) {
    const letterOffset = (remaining - 1) % 26;
    label = String.fromCharCode(65 + letterOffset) + label;
    remaining = Math.floor((remaining - 1) / 26);
  }

  return label;
}

export function columnLabelToIndex(columnLabel: string): ParseResult<number> {
  if (!/^[A-Za-z]+$/.test(columnLabel)) {
    return { ok: false, reason: 'invalid-format' };
  }

  let index = 0;
  for (const letter of columnLabel.toUpperCase()) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }

  return { ok: true, value: index - 1 };
}

export function cellKey(address: CellAddress): CellKey {
  return `${columnIndexToLabel(address.columnIndex)}${address.rowIndex + 1}`;
}

export function parseA1Address(input: string, bounds?: Pick<Sheet, 'columnCount' | 'rowCount'>): ParseResult<CellAddress> {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(input.trim());
  if (!match) {
    return { ok: false, reason: 'invalid-format' };
  }

  const columnIndex = columnLabelToIndex(match[1]);
  if (!columnIndex.ok) {
    return columnIndex;
  }

  const rowIndex = Number.parseInt(match[2], 10) - 1;
  const address = { columnIndex: columnIndex.value, rowIndex };

  if (bounds && !isAddressWithinBounds(address, bounds)) {
    return { ok: false, reason: 'out-of-bounds' };
  }

  return { ok: true, value: address };
}

export function parseA1Range(input: string, bounds?: Pick<Sheet, 'columnCount' | 'rowCount'>): ParseResult<CellRange> {
  const parts = input.split(':');
  if (parts.length !== 2) {
    return { ok: false, reason: 'invalid-format' };
  }

  const start = parseA1Address(parts[0], bounds);
  if (!start.ok) {
    return start;
  }

  const end = parseA1Address(parts[1], bounds);
  if (!end.ok) {
    return end;
  }

  return {
    ok: true,
    value: normalizeRange({ start: start.value, end: end.value }),
  };
}

export function expandRange(range: CellRange, bounds: Pick<Sheet, 'columnCount' | 'rowCount'>): ParseResult<CellAddress[]> {
  const normalized = normalizeRange(range);
  if (
    !isAddressWithinBounds(normalized.start, bounds) ||
    !isAddressWithinBounds(normalized.end, bounds)
  ) {
    return { ok: false, reason: 'out-of-bounds' };
  }

  const addresses: CellAddress[] = [];
  for (let rowIndex = normalized.start.rowIndex; rowIndex <= normalized.end.rowIndex; rowIndex += 1) {
    for (
      let columnIndex = normalized.start.columnIndex;
      columnIndex <= normalized.end.columnIndex;
      columnIndex += 1
    ) {
      addresses.push({ columnIndex, rowIndex });
    }
  }

  return { ok: true, value: addresses };
}

export function parseNamedA1Address(
  input: string,
  workbook: Workbook,
  defaultSheet?: Sheet,
): ParseResult<NamedCellReference> {
  const reference = splitSheetReference(input);
  if (!reference.ok) {
    return reference;
  }

  const sheet = resolveReferenceSheet(reference.value.sheetName, workbook, defaultSheet);
  if (!sheet.ok) {
    return sheet;
  }

  const address = parseA1Address(reference.value.reference, sheet.value);
  if (!address.ok) {
    return address;
  }

  return {
    ok: true,
    value: {
      ...address.value,
      sheetName: reference.value.sheetName,
    },
  };
}

export function parseNamedA1Range(
  input: string,
  workbook: Workbook,
  defaultSheet?: Sheet,
): ParseResult<NamedRangeReference> {
  const reference = splitSheetReference(input);
  if (!reference.ok) {
    return reference;
  }

  const sheet = resolveReferenceSheet(reference.value.sheetName, workbook, defaultSheet);
  if (!sheet.ok) {
    return sheet;
  }

  const range = parseA1Range(reference.value.reference, sheet.value);
  if (!range.ok) {
    return range;
  }

  return {
    ok: true,
    value: {
      ...range.value,
      sheetName: reference.value.sheetName,
    },
  };
}

export function parseFormula(
  raw: string,
  workbook: Workbook,
  defaultSheet?: Sheet,
): FormulaParseResult {
  if (!raw.startsWith('=')) {
    return { kind: 'not-formula', raw };
  }

  const parser = new FormulaParser(raw.slice(1), workbook, defaultSheet);
  return parser.parse(raw);
}

export function evaluateFormulaCells(workbook: Workbook): FormulaEvaluationSnapshot {
  const evaluator = new FormulaEvaluator(workbook);
  return evaluator.evaluate();
}

export function isAddressWithinBounds(
  address: CellAddress,
  bounds: Pick<Sheet, 'columnCount' | 'rowCount'>,
): boolean {
  return (
    address.columnIndex >= 0 &&
    address.rowIndex >= 0 &&
    address.columnIndex < bounds.columnCount &&
    address.rowIndex < bounds.rowCount
  );
}

function normalizeRange(range: CellRange): CellRange {
  return {
    start: {
      columnIndex: Math.min(range.start.columnIndex, range.end.columnIndex),
      rowIndex: Math.min(range.start.rowIndex, range.end.rowIndex),
    },
    end: {
      columnIndex: Math.max(range.start.columnIndex, range.end.columnIndex),
      rowIndex: Math.max(range.start.rowIndex, range.end.rowIndex),
    },
  };
}

function resolveReferenceSheet(
  sheetName: string | undefined,
  workbook: Workbook,
  defaultSheet: Sheet | undefined,
): ParseResult<Sheet> {
  if (!sheetName) {
    if (!defaultSheet) {
      return { ok: false, reason: 'unknown-sheet' };
    }
    return { ok: true, value: defaultSheet };
  }

  return findSheetByName(workbook, sheetName);
}

function resolveFormulaReferenceSheet(
  reference: Pick<FormulaReference, 'sheetId'>,
  workbook: Workbook,
  defaultSheet: Sheet | undefined,
): ParseResult<Sheet> {
  if (reference.sheetId) {
    const sheet = workbook.sheets.find((candidate) => candidate.id === reference.sheetId);
    return sheet ? { ok: true, value: sheet } : { ok: false, reason: 'unknown-sheet' };
  }

  if (!defaultSheet) {
    return { ok: false, reason: 'unknown-sheet' };
  }
  return { ok: true, value: defaultSheet };
}

function sheetCellNodeId(sheetId: string, key: CellKey): string {
  return `${sheetId}\u0000${key}`;
}

function numericDisplay(value: number): FormulaDisplayResult {
  return { kind: 'number', value, display: String(value) };
}

function formulaError(error: FormulaErrorCode): FormulaDisplayResult {
  return { kind: 'error', error, display: error };
}

function parseStrictNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  if (!/^-?[0-9]+(?:\.[0-9]+)?$/.test(trimmed)) {
    return undefined;
  }

  return Number(trimmed);
}

class FormulaEvaluator {
  private readonly results = new Map<string, FormulaDisplayResult>();
  private readonly visiting = new Set<string>();
  private readonly stack: { nodeId: string; sheet: Sheet; key: CellKey }[] = [];

  constructor(private readonly workbook: Workbook) {}

  evaluate(): FormulaEvaluationSnapshot {
    for (const sheet of this.workbook.sheets) {
      for (const key of Object.keys(sheet.cells).sort()) {
        if (sheet.cells[key].startsWith('=')) {
          this.evaluateFormulaCell(sheet, key);
        }
      }
    }

    const snapshot: FormulaEvaluationSnapshot = {};
    for (const sheet of this.workbook.sheets) {
      const sheetResults: Record<CellKey, FormulaDisplayResult> = {};
      for (const key of Object.keys(sheet.cells).sort()) {
        const result = this.results.get(sheetCellNodeId(sheet.id, key));
        if (result) {
          sheetResults[key] = result;
        }
      }
      snapshot[sheet.id] = sheetResults;
    }

    return snapshot;
  }

  private evaluateFormulaCell(sheet: Sheet, key: CellKey): FormulaDisplayResult {
    const nodeId = sheetCellNodeId(sheet.id, key);
    const cached = this.results.get(nodeId);
    if (cached) {
      return cached;
    }

    if (this.visiting.has(nodeId)) {
      const cycleStart = this.stack.findIndex((entry) => entry.nodeId === nodeId);
      for (const entry of this.stack.slice(cycleStart)) {
        this.results.set(entry.nodeId, formulaError('#CYCLE!'));
      }
      return formulaError('#CYCLE!');
    }

    const cell = sheet.cells[key];
    if (!cell?.startsWith('=')) {
      return this.evaluateLiteralCell(sheet, key);
    }

    this.visiting.add(nodeId);
    this.stack.push({ nodeId, sheet, key });

    let result: FormulaDisplayResult;
    const parsed = parseFormula(cell, this.workbook, sheet);
    if (parsed.kind === 'error') {
      result = formulaError(parsed.error);
    } else if (parsed.kind === 'formula') {
      result = parsed.expression.kind === 'sum'
        ? this.evaluateSum(parsed.expression, sheet)
        : formulaError('#VALUE!');
    } else {
      result = formulaError('#PARSE!');
    }

    this.stack.pop();
    this.visiting.delete(nodeId);

    const cycleResult = this.results.get(nodeId);
    if (cycleResult?.kind === 'error' && cycleResult.error === '#CYCLE!') {
      return cycleResult;
    }

    this.results.set(nodeId, result);
    return result;
  }

  private evaluateSum(expression: SumFormula, currentSheet: Sheet): FormulaDisplayResult {
    let total = 0;

    for (const argument of expression.arguments) {
      if (argument.kind !== 'cell' && argument.kind !== 'range') {
        return formulaError('#VALUE!');
      }
      const cells = this.resolveArgumentCells(argument, currentSheet);
      if (!cells.ok) {
        return formulaError(cells.error);
      }

      for (const cell of cells.value) {
        const value = this.evaluateReferencedCell(cell.sheet, cell.key);
        if (!value.ok) {
          return formulaError(value.error);
        }
        total += value.value;
      }
    }

    return numericDisplay(total);
  }

  private resolveArgumentCells(
    argument: FormulaReference,
    currentSheet: Sheet,
  ): { ok: true; value: { sheet: Sheet; key: CellKey }[] } | { ok: false; error: FormulaErrorCode } {
    const sheet = resolveFormulaReferenceSheet(argument, this.workbook, currentSheet);
    if (!sheet.ok) {
      return { ok: false, error: '#REF!' };
    }

    if (argument.kind === 'cell') {
      if (!isAddressWithinBounds(argument.address, sheet.value)) {
        return { ok: false, error: '#REF!' };
      }
      return { ok: true, value: [{ sheet: sheet.value, key: cellKey(argument.address) }] };
    }

    const range = expandRange(argument.range, sheet.value);
    if (!range.ok) {
      return { ok: false, error: '#REF!' };
    }

    return {
      ok: true,
      value: range.value.map((address) => ({ sheet: sheet.value, key: cellKey(address) })),
    };
  }

  private evaluateReferencedCell(
    sheet: Sheet,
    key: CellKey,
  ): { ok: true; value: number } | { ok: false; error: FormulaErrorCode } {
    const cell = sheet.cells[key];
    if (!cell) {
      return { ok: true, value: 0 };
    }

    if (cell.startsWith('=')) {
      const result = this.evaluateFormulaCell(sheet, key);
      if (result.kind === 'error') {
        return { ok: false, error: result.error };
      }
      return { ok: true, value: result.value };
    }

    const parsed = parseStrictNumber(cell);
    if (parsed === undefined) {
      return { ok: false, error: '#VALUE!' };
    }

    return { ok: true, value: parsed };
  }

  private evaluateLiteralCell(
    sheet: Sheet,
    key: CellKey,
  ): FormulaDisplayResult {
    const value = parseStrictNumber(sheet.cells[key] ?? '');
    return value === undefined ? formulaError('#VALUE!') : numericDisplay(value);
  }
}

export function formulaRawForStorage(raw: string, workbook: Workbook): string {
  return replaceSheetReferenceTokens(raw, (sheetReference) => {
    if (sheetReference === '#REF') {
      return sheetReference;
    }
    return workbook.sheets.find(
      (candidate) => candidate.name === sheetReference || candidate.id === sheetReference,
    )?.id ?? '#REF';
  });
}

export function formulaRawForDisplay(raw: string, workbook: Workbook): string {
  return replaceSheetReferenceTokens(raw, (sheetId) => {
    const sheet = workbook.sheets.find((candidate) => candidate.id === sheetId);
    return sheet ? formatSheetReferenceToken(sheet.name) : '#REF';
  });
}

export function formulaSheetReferenceIds(raw: string): string[] {
  return findSheetReferenceTokens(raw)
    .map((token) => token.sheetName)
    .filter((sheetId) => sheetId !== '#REF');
}

export function remapFormulaSheetIds(raw: string, remaps: ReadonlyMap<string, string>): string {
  return replaceSheetReferenceTokens(raw, (sheetId) => remaps.get(sheetId) ?? sheetId);
}

export function remapWorkbookFormulaSheetId(workbook: Workbook, fromSheetId: string, toSheetId: string): Workbook {
  const remaps = new Map([[fromSheetId, toSheetId]]);
  let changed = false;
  const sheets = workbook.sheets.map((sheet) => {
    let sheetChanged = false;
    const cells = Object.fromEntries(
      Object.entries(sheet.cells).map(([key, content]) => {
        const remapped = remapFormulaSheetIds(content, remaps);
        sheetChanged ||= remapped !== content;
        return [key, remapped];
      }),
    );
    changed ||= sheetChanged;
    return sheetChanged ? { ...sheet, cells } : sheet;
  });
  return changed ? { ...workbook, sheets } : workbook;
}

function replaceSheetReferenceTokens(raw: string, replacement: (sheetReference: string) => string): string {
  return findSheetReferenceTokens(raw)
    .sort((first, second) => second.startIndex - first.startIndex)
    .reduce(
      (result, token) => result.slice(0, token.startIndex) + replacement(token.sheetName) + result.slice(token.endIndex),
      raw,
    );
}

function formatSheetReferenceToken(sheetName: string): string {
  const quoted = !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheetName);
  return quoted ? `'${sheetName.replace(/'/g, "''")}'` : sheetName;
}

function findSheetReferenceTokens(raw: string): { startIndex: number; endIndex: number; sheetName: string }[] {
  if (!raw.startsWith('=')) {
    return [];
  }

  const tokens: { startIndex: number; endIndex: number; sheetName: string }[] = [];
  for (let separatorIndex = 0; separatorIndex < raw.length; separatorIndex += 1) {
    if (raw[separatorIndex] === '"') {
      separatorIndex = findTextLiteralEnd(raw, separatorIndex);
      continue;
    }
    if (raw[separatorIndex] !== '!' || !hasA1ReferenceAfter(raw, separatorIndex)) {
      continue;
    }

    const rawBeforeSeparator = raw.slice(0, separatorIndex);
    const lastNonWhitespaceIndex = findLastNonWhitespaceIndex(rawBeforeSeparator);
    const endIndex = lastNonWhitespaceIndex + 1;
    const startIndex = findSheetReferenceTokenStart(raw, endIndex);
    if (startIndex === undefined) {
      continue;
    }

    const parsed = parseSheetReferenceToken(raw.slice(startIndex, endIndex));
    if (parsed) {
      tokens.push({ startIndex, endIndex, sheetName: parsed.sheetName });
    }
  }

  return tokens;
}

function findTextLiteralEnd(raw: string, openingQuoteIndex: number): number {
  let cursor = openingQuoteIndex + 1;
  while (cursor < raw.length) {
    if (raw[cursor] !== '"') {
      cursor += 1;
      continue;
    }
    if (raw[cursor + 1] === '"') {
      cursor += 2;
      continue;
    }
    return cursor;
  }
  return raw.length;
}

function hasA1ReferenceAfter(raw: string, separatorIndex: number): boolean {
  let referenceStart = separatorIndex + 1;
  while (referenceStart < raw.length && /\s/.test(raw[referenceStart])) {
    referenceStart += 1;
  }
  if (referenceStart >= raw.length) {
    return false;
  }

  const match = /^[A-Za-z]+[1-9][0-9]*/.exec(raw.slice(referenceStart));
  if (!match) {
    return false;
  }

  const nextChar = raw[referenceStart + match[0].length];
  return !nextChar || /\s/.test(nextChar) || nextChar === ':' || nextChar === ',' || nextChar === ')';
}

function findLastNonWhitespaceIndex(input: string): number {
  for (let index = input.length - 1; index >= 0; index -= 1) {
    if (!/\s/.test(input[index])) {
      return index;
    }
  }

  return -1;
}

function findSheetReferenceTokenStart(raw: string, endIndex: number): number | undefined {
  if (endIndex <= 0) {
    return undefined;
  }
  if (raw[endIndex - 1] !== "'") {
    const boundary =
      Math.max(
        raw.lastIndexOf('(', endIndex - 1),
        raw.lastIndexOf(',', endIndex - 1),
      ) + 1;
    for (let index = boundary; index < endIndex; index += 1) {
      if (!/\s/.test(raw[index])) {
        return index;
      }
    }
    return undefined;
  }

  let cursor = endIndex - 2;
  while (cursor >= 0) {
    if (raw[cursor] !== "'") {
      cursor -= 1;
      continue;
    }
    if (cursor > 0 && raw[cursor - 1] === "'") {
      cursor -= 2;
      continue;
    }
    return cursor;
  }

  return undefined;
}

function parseSheetReferenceToken(token: string): { sheetName: string } | undefined {
  const trimmedToken = token.trim();
  if (!trimmedToken.startsWith("'")) {
    return trimmedToken.length > 0 && !/[(),"'\!]/.test(trimmedToken) ? { sheetName: trimmedToken } : undefined;
  }
  if (!trimmedToken.endsWith("'") || trimmedToken.length < 3) {
    return undefined;
  }

  const inner = trimmedToken.slice(1, -1);
  for (let cursor = 0; cursor < inner.length; cursor += 1) {
    if (inner[cursor] !== "'") {
      continue;
    }
    if (inner[cursor + 1] !== "'") {
      return undefined;
    }
    cursor += 1;
  }

  return { sheetName: inner.replace(/''/g, "'") };
}

function splitSheetReference(
  input: string,
): ParseResult<{ sheetName?: string; reference: string }> {
  const trimmedInput = input.trim();
  if (trimmedInput.startsWith("'")) {
    const closingQuoteIndex = trimmedInput.indexOf("'!");
    if (closingQuoteIndex <= 1) {
      return { ok: false, reason: 'invalid-format' };
    }

    return {
      ok: true,
      value: {
        sheetName: trimmedInput.slice(1, closingQuoteIndex),
        reference: trimmedInput.slice(closingQuoteIndex + 2),
      },
    };
  }

  const separatorIndex = trimmedInput.indexOf('!');
  if (separatorIndex === -1) {
    return { ok: true, value: { reference: trimmedInput } };
  }

  if (separatorIndex === 0 || separatorIndex === trimmedInput.length - 1) {
    return { ok: false, reason: 'invalid-format' };
  }

  return {
    ok: true,
    value: {
      sheetName: trimmedInput.slice(0, separatorIndex).trim(),
      reference: trimmedInput.slice(separatorIndex + 1),
    },
  };
}

class FormulaParser {
  private index = 0;
  private deferredNameError = false;

  constructor(
    private readonly input: string,
    private readonly workbook: Workbook,
    private readonly defaultSheet: Sheet | undefined,
  ) {}

  parse(raw: string): FormulaParseResult {
    this.skipWhitespace();
    const expression = this.readExpression();
    if (!expression.ok) {
      if (expression.error === '#NAME!') {
        this.skipWhitespace();
        if (!this.isAtEnd()) {
          return { kind: 'error', raw, error: '#PARSE!' };
        }
      }
      return { kind: 'error', raw, error: expression.error };
    }

    this.skipWhitespace();
    if (!this.isAtEnd()) {
      return { kind: 'error', raw, error: '#PARSE!' };
    }
    if (this.deferredNameError) {
      return { kind: 'error', raw, error: '#NAME!' };
    }
    if (!this.referencesAreValid(expression.value)) {
      return { kind: 'error', raw, error: '#REF!' };
    }

    return {
      kind: 'formula',
      raw,
      expression: expression.value,
    };
  }

  private readExpression(
    validateSemantics = true,
  ): { ok: true; value: FormulaExpression } | { ok: false; error: FormulaErrorCode } {
    this.skipWhitespace();
    const startIndex = this.index;

    if (this.consume('(')) {
      const expression = this.readExpression(validateSemantics);
      if (!expression.ok) {
        return expression;
      }
      this.skipWhitespace();
      if (!this.consume(')')) {
        return { ok: false, error: '#PARSE!' };
      }
      return {
        ok: true,
        value: {
          kind: 'group',
          expression: expression.value,
          sourceSpan: this.sourceSpan(startIndex),
        },
      };
    }

    if (this.peek() === '"') {
      return this.readTextLiteral();
    }

    if (this.findUnquotedSheetSeparator() !== -1) {
      return this.readReferenceArgument();
    }

    const number = this.readNumberLiteral();
    if (number) {
      return { ok: true, value: number };
    }

    const identifierStart = this.index;
    const identifier = this.readIdentifier();
    if (identifier) {
      const normalized = identifier.toUpperCase();
      if ((normalized === 'TRUE' || normalized === 'FALSE') && !this.isIdentifierContinuation(this.peek())) {
        return {
          ok: true,
          value: {
            kind: 'boolean',
            value: normalized === 'TRUE',
            sourceSpan: this.sourceSpan(identifierStart),
          },
        };
      }

      this.skipWhitespace();
      if (this.peek() === '(') {
        return this.readFunctionCall(identifier, identifierStart, validateSemantics);
      }
      this.index = identifierStart;
    }

    return this.readReferenceArgument();
  }

  private readFunctionCall(
    functionName: string,
    startIndex: number,
    validateSemantics: boolean,
  ): { ok: true; value: FormulaExpression } | { ok: false; error: FormulaErrorCode } {
    if (!this.consume('(')) {
      return { ok: false, error: '#PARSE!' };
    }
    const isSum = functionName.toUpperCase() === 'SUM';

    this.skipWhitespace();
    if (this.peek() === ')') {
      this.index += 1;
      if (validateSemantics && !isSum) {
        return { ok: false, error: '#NAME!' };
      }
      if (!isSum) {
        this.deferredNameError = true;
      }
      return {
        ok: true,
        value: {
          kind: 'sum',
          functionName: 'SUM',
          arguments: [],
          sourceSpan: this.sourceSpan(startIndex),
        },
      };
    }

    const args: FormulaExpression[] = [];
    while (true) {
      const arg = this.readExpression(false);
      if (!arg.ok) {
        return arg;
      }
      args.push(arg.value);

      this.skipWhitespace();
      if (this.consume(',')) {
        this.skipWhitespace();
        if (this.peek() === ')' || this.isAtEnd()) {
          return { ok: false, error: '#PARSE!' };
        }
        continue;
      }
      if (!this.consume(')')) {
        return { ok: false, error: '#PARSE!' };
      }
      break;
    }

    if (validateSemantics && !isSum) {
      return { ok: false, error: '#NAME!' };
    }
    if (!isSum) {
      this.deferredNameError = true;
    }

    return {
      ok: true,
      value: {
        kind: 'sum',
        functionName: 'SUM',
        arguments: args,
        sourceSpan: this.sourceSpan(startIndex),
      },
    };
  }

  private readNumberLiteral(): FormulaLiteral | undefined {
    const startIndex = this.index;
    const match = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(
      this.input.slice(this.index),
    );
    if (!match) {
      return undefined;
    }

    this.index += match[0].length;
    return {
      kind: 'number',
      value: Number(match[0]),
      sourceSpan: this.sourceSpan(startIndex),
    };
  }

  private readTextLiteral(): { ok: true; value: FormulaLiteral } | { ok: false; error: FormulaErrorCode } {
    const startIndex = this.index;
    this.index += 1;
    let value = '';

    while (!this.isAtEnd()) {
      const char = this.peek();
      if (char !== '"') {
        value += char;
        this.index += 1;
        continue;
      }
      if (this.input[this.index + 1] === '"') {
        value += '"';
        this.index += 2;
        continue;
      }

      this.index += 1;
      return {
        ok: true,
        value: {
          kind: 'text',
          value,
          sourceSpan: this.sourceSpan(startIndex),
        },
      };
    }

    return { ok: false, error: '#PARSE!' };
  }

  private readReferenceArgument(): { ok: true; value: FormulaReference } | { ok: false; error: FormulaErrorCode } {
    const startIndex = this.index;
    const sheetReference = this.readOptionalSheetReference();
    if (sheetReference === false) {
      return { ok: false, error: '#PARSE!' };
    }

    const startAddressToken = this.readA1AddressToken();
    if (!startAddressToken) {
      return { ok: false, error: '#PARSE!' };
    }
    const startAddressEndIndex = this.index;

    const syntaxBounds = { columnCount: Number.MAX_SAFE_INTEGER, rowCount: Number.MAX_SAFE_INTEGER };
    const startAddress = parseA1Address(startAddressToken, syntaxBounds);
    if (!startAddress.ok) {
      return { ok: false, error: startAddress.reason === 'out-of-bounds' ? '#REF!' : '#PARSE!' };
    }

    this.skipWhitespace();
    if (!this.consume(':')) {
      return {
        ok: true,
        value: {
          kind: 'cell',
          ...(sheetReference.sheetId === undefined ? {} : { sheetId: sheetReference.sheetId }),
          address: startAddress.value,
          sourceSpan: this.span(startIndex, startAddressEndIndex),
          ...(sheetReference.sourceSpan === undefined ? {} : { sheetReferenceSpan: sheetReference.sourceSpan }),
        },
      };
    }

    this.skipWhitespace();
    const endAddressToken = this.readA1AddressToken();
    if (!endAddressToken) {
      return { ok: false, error: '#PARSE!' };
    }
    const endAddressEndIndex = this.index;

    const endAddress = parseA1Address(endAddressToken, syntaxBounds);
    if (!endAddress.ok) {
      return { ok: false, error: endAddress.reason === 'out-of-bounds' ? '#REF!' : '#PARSE!' };
    }

    return {
      ok: true,
      value: {
        kind: 'range',
        ...(sheetReference.sheetId === undefined ? {} : { sheetId: sheetReference.sheetId }),
        range: normalizeRange({ start: startAddress.value, end: endAddress.value }),
        sourceSpan: this.span(startIndex, endAddressEndIndex),
        ...(sheetReference.sourceSpan === undefined ? {} : { sheetReferenceSpan: sheetReference.sourceSpan }),
      },
    };
  }

  private readOptionalSheetReference(): { sheetId?: string; sourceSpan?: FormulaSourceSpan } | false {
    const startIndex = this.index;
    const quotedSheetName = this.readQuotedSheetName();
    if (quotedSheetName === false) {
      return false;
    }
    if (quotedSheetName !== undefined) {
      const qualifierEndIndex = this.index;
      this.skipWhitespace();
      if (!this.consume('!')) {
        return false;
      }
      this.skipWhitespace();
      return {
        sheetId: quotedSheetName,
        sourceSpan: this.span(startIndex, qualifierEndIndex),
      };
    }

    this.index = startIndex;
    const separatorIndex = this.findUnquotedSheetSeparator();
    if (separatorIndex === -1) {
      return {};
    }

    let qualifierEndIndex = separatorIndex;
    while (qualifierEndIndex > startIndex && /\s/.test(this.input[qualifierEndIndex - 1])) {
      qualifierEndIndex -= 1;
    }
    const sheetId = this.input.slice(this.index, qualifierEndIndex);
    if (sheetId.length === 0 || sheetId.includes("'")) {
      return false;
    }

    this.index = separatorIndex + 1;
    this.skipWhitespace();
    return { sheetId, sourceSpan: this.span(startIndex, qualifierEndIndex) };
  }

  private readQuotedSheetName(): string | undefined | false {
    if (this.peek() !== "'") {
      return undefined;
    }

    this.index += 1;
    let sheetName = '';
    while (!this.isAtEnd()) {
      const char = this.peek();
      if (char !== "'") {
        sheetName += char;
        this.index += 1;
        continue;
      }

      if (this.input[this.index + 1] === "'") {
        sheetName += "'";
        this.index += 2;
        continue;
      }

      this.index += 1;
      return sheetName.length > 0 ? sheetName : false;
    }

    return false;
  }

  private findUnquotedSheetSeparator(): number {
    let cursor = this.index;
    while (cursor < this.input.length) {
      const char = this.input[cursor];
      if (char === '!') {
        return cursor;
      }
      if (char === '(' || char === ',' || char === ')' || char === ':') {
        return -1;
      }
      cursor += 1;
    }

    return -1;
  }

  private readA1AddressToken(): string | undefined {
    const match = /^[A-Za-z]+[1-9][0-9]*/.exec(this.input.slice(this.index));
    if (!match) {
      return undefined;
    }

    this.index += match[0].length;
    const nextChar = this.peek();
    if (nextChar && /[A-Za-z0-9]/.test(nextChar)) {
      return undefined;
    }

    return match[0];
  }

  private readIdentifier(): string | undefined {
    const match = /^[A-Za-z][A-Za-z0-9_]*/.exec(this.input.slice(this.index));
    if (!match) {
      return undefined;
    }

    this.index += match[0].length;
    return match[0];
  }

  private isIdentifierContinuation(char: string): boolean {
    return char.length > 0 && /[A-Za-z0-9_]/.test(char);
  }

  private referencesAreValid(expression: FormulaExpression): boolean {
    if (expression.kind === 'number' || expression.kind === 'text' || expression.kind === 'boolean') {
      return true;
    }
    if (expression.kind === 'group') {
      return this.referencesAreValid(expression.expression);
    }
    if (expression.kind === 'sum') {
      return expression.arguments.every((argument) => this.referencesAreValid(argument));
    }

    const sheet = resolveFormulaReferenceSheet(expression, this.workbook, this.defaultSheet);
    if (!sheet.ok) {
      return false;
    }
    if (expression.kind === 'cell') {
      return isAddressWithinBounds(expression.address, sheet.value);
    }
    return (
      isAddressWithinBounds(expression.range.start, sheet.value)
      && isAddressWithinBounds(expression.range.end, sheet.value)
    );
  }

  private sourceSpan(startIndex: number): FormulaSourceSpan {
    return this.span(startIndex, this.index);
  }

  private span(startIndex: number, endIndex: number): FormulaSourceSpan {
    return { start: startIndex + 1, end: endIndex + 1 };
  }

  private skipWhitespace(): void {
    while (!this.isAtEnd() && /\s/.test(this.peek())) {
      this.index += 1;
    }
  }

  private consume(char: string): boolean {
    if (this.peek() !== char) {
      return false;
    }

    this.index += 1;
    return true;
  }

  private peek(): string {
    return this.input[this.index] ?? '';
  }

  private isAtEnd(): boolean {
    return this.index >= this.input.length;
  }
}
