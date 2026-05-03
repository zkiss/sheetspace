export const WORKBOOK_SCHEMA_VERSION = 1;
export const DEFAULT_COLUMN_COUNT = 10;
export const DEFAULT_ROW_COUNT = 20;

export type Workbook = {
  version: typeof WORKBOOK_SCHEMA_VERSION;
  sheets: Sheet[];
};

export type Sheet = {
  id: string;
  name: string;
  position: WorkspacePosition;
  columnCount: number;
  rowCount: number;
  cells: Record<CellKey, CellContent>;
};

export type WorkspacePosition = {
  x: number;
  y: number;
};

export type CellContent = {
  raw: string;
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

export type FormulaReference =
  | {
      kind: 'cell';
      sheetName?: string;
      address: CellAddress;
    }
  | {
      kind: 'range';
      sheetName?: string;
      range: CellRange;
    };

export type SumFormula = {
  kind: 'sum';
  functionName: 'SUM';
  arguments: FormulaReference[];
};

export type FormulaParseResult =
  | { kind: 'not-formula'; raw: string }
  | { kind: 'formula'; raw: string; expression: SumFormula }
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
  existingSheets?: Pick<Sheet, 'id' | 'name'>[];
  position?: WorkspacePosition;
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
      position: input.position ?? { x: 0, y: 0 },
      columnCount: DEFAULT_COLUMN_COUNT,
      rowCount: DEFAULT_ROW_COUNT,
      cells: {},
    },
  };
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

export function commitCellRawContent(workbook: Workbook, sheetId: string, key: CellKey, raw: string): Workbook {
  let changed = false;
  const sheets = workbook.sheets.map((sheet) => {
    if (sheet.id !== sheetId) {
      return sheet;
    }

    const existingCell = sheet.cells[key];
    if (raw.length === 0) {
      if (!existingCell) {
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

    if (existingCell?.raw === raw) {
      return sheet;
    }

    changed = true;
    const cells = { ...sheet.cells };
    cells[key] = { raw };

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

export function parseFormula(raw: string, workbook: Workbook, defaultSheet?: Sheet): FormulaParseResult {
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
        if (sheet.cells[key].raw.startsWith('=')) {
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
    if (!cell?.raw.startsWith('=')) {
      return this.evaluateLiteralCell(sheet, key);
    }

    this.visiting.add(nodeId);
    this.stack.push({ nodeId, sheet, key });

    const parsed = parseFormula(cell.raw, this.workbook, sheet);
    let result: FormulaDisplayResult;
    if (parsed.kind === 'error') {
      result = formulaError(parsed.error);
    } else if (parsed.kind === 'formula') {
      result = this.evaluateSum(parsed.expression, sheet);
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
    const sheet = resolveReferenceSheet(argument.sheetName, this.workbook, currentSheet);
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

    if (cell.raw.startsWith('=')) {
      const result = this.evaluateFormulaCell(sheet, key);
      if (result.kind === 'error') {
        return { ok: false, error: result.error };
      }
      return { ok: true, value: result.value };
    }

    const parsed = parseStrictNumber(cell.raw);
    if (parsed === undefined) {
      return { ok: false, error: '#VALUE!' };
    }

    return { ok: true, value: parsed };
  }

  private evaluateLiteralCell(
    sheet: Sheet,
    key: CellKey,
  ): FormulaDisplayResult {
    const value = parseStrictNumber(sheet.cells[key]?.raw ?? '');
    return value === undefined ? formulaError('#VALUE!') : numericDisplay(value);
  }
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

  constructor(
    private readonly input: string,
    private readonly workbook: Workbook,
    private readonly defaultSheet: Sheet | undefined,
  ) {}

  parse(raw: string): FormulaParseResult {
    this.skipWhitespace();
    const functionName = this.readIdentifier();
    if (!functionName) {
      return { kind: 'error', raw, error: '#PARSE!' };
    }

    this.skipWhitespace();
    if (!this.consume('(')) {
      return { kind: 'error', raw, error: '#PARSE!' };
    }

    if (functionName.toUpperCase() !== 'SUM') {
      return { kind: 'error', raw, error: '#NAME!' };
    }

    this.skipWhitespace();
    if (this.peek() === ')') {
      return { kind: 'error', raw, error: '#PARSE!' };
    }

    const args: FormulaReference[] = [];
    while (true) {
      const arg = this.readReferenceArgument();
      if (!arg.ok) {
        return { kind: 'error', raw, error: arg.error };
      }
      args.push(arg.value);

      this.skipWhitespace();
      if (this.consume(',')) {
        this.skipWhitespace();
        if (this.peek() === ')' || this.isAtEnd()) {
          return { kind: 'error', raw, error: '#PARSE!' };
        }
        continue;
      }

      if (!this.consume(')')) {
        return { kind: 'error', raw, error: '#PARSE!' };
      }
      break;
    }

    this.skipWhitespace();
    if (!this.isAtEnd()) {
      return { kind: 'error', raw, error: '#PARSE!' };
    }

    return {
      kind: 'formula',
      raw,
      expression: {
        kind: 'sum',
        functionName: 'SUM',
        arguments: args,
      },
    };
  }

  private readReferenceArgument(): { ok: true; value: FormulaReference } | { ok: false; error: FormulaErrorCode } {
    const sheetName = this.readOptionalSheetName();
    if (sheetName === false) {
      return { ok: false, error: '#PARSE!' };
    }

    const sheet = resolveReferenceSheet(sheetName, this.workbook, this.defaultSheet);
    if (!sheet.ok) {
      return { ok: false, error: '#REF!' };
    }

    const startAddressToken = this.readA1AddressToken();
    if (!startAddressToken) {
      return { ok: false, error: '#PARSE!' };
    }

    const startAddress = parseA1Address(startAddressToken, sheet.value);
    if (!startAddress.ok) {
      return { ok: false, error: startAddress.reason === 'out-of-bounds' ? '#REF!' : '#PARSE!' };
    }

    this.skipWhitespace();
    if (!this.consume(':')) {
      return {
        ok: true,
        value: { kind: 'cell', sheetName, address: startAddress.value },
      };
    }

    this.skipWhitespace();
    const endAddressToken = this.readA1AddressToken();
    if (!endAddressToken) {
      return { ok: false, error: '#PARSE!' };
    }

    const endAddress = parseA1Address(endAddressToken, sheet.value);
    if (!endAddress.ok) {
      return { ok: false, error: endAddress.reason === 'out-of-bounds' ? '#REF!' : '#PARSE!' };
    }

    return {
      ok: true,
      value: {
        kind: 'range',
        sheetName,
        range: normalizeRange({ start: startAddress.value, end: endAddress.value }),
      },
    };
  }

  private readOptionalSheetName(): string | undefined | false {
    const startIndex = this.index;
    const quotedSheetName = this.readQuotedSheetName();
    if (quotedSheetName !== undefined) {
      this.skipWhitespace();
      if (!this.consume('!')) {
        return false;
      }
      this.skipWhitespace();
      return quotedSheetName;
    }

    this.index = startIndex;
    const separatorIndex = this.findUnquotedSheetSeparator();
    if (separatorIndex === -1) {
      return undefined;
    }

    const sheetName = this.input.slice(this.index, separatorIndex).trim();
    if (sheetName.length === 0 || sheetName.includes("'")) {
      return false;
    }

    this.index = separatorIndex + 1;
    this.skipWhitespace();
    return sheetName;
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
      if (char === ',' || char === ')' || char === ':') {
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
