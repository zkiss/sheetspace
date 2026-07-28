import {
  cellKey,
  expandRange,
  isAddressWithinBounds,
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
  type BinaryFormula,
  type FormulaErrorCode,
  type FormulaExpression,
  type FormulaParseResult,
  type FormulaReference,
  type FunctionFormula,
  type UnaryFormula,
} from './formulaSyntax';

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

export type NamedCellReference = CellAddress & {
  sheetName?: string;
};

export type NamedRangeReference = CellRange & {
  sheetName?: string;
};

export type FormulaScalarValue =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'blank' }
  | { kind: 'error'; error: FormulaErrorCode };

export type FormulaRangeValue = {
  kind: 'range';
  values: Iterable<FormulaScalarValue>;
  rowCount: number;
  columnCount: number;
};

export type FormulaValue = FormulaScalarValue | FormulaRangeValue;

export type FormulaDisplayResult =
  | { kind: 'number'; value: number; display: string }
  | { kind: 'text'; value: string; display: string }
  | { kind: 'boolean'; value: boolean; display: 'TRUE' | 'FALSE' }
  | { kind: 'blank'; display: '' }
  | { kind: 'error'; error: FormulaErrorCode; display: FormulaErrorCode };

export type FormulaEvaluationSnapshot = Record<string, Record<CellKey, FormulaDisplayResult>>;

export type FormulaEvaluationObserver = (sheetId: string, cellKey: CellKey) => void;

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
  _workbook: Workbook,
  _defaultSheet?: Sheet,
): FormulaParseResult {
  return parseFormulaSyntax(raw);
}

export function evaluateFormulaCells(workbook: Workbook): FormulaEvaluationSnapshot {
  const evaluator = new FormulaEvaluator(workbook);
  return evaluator.evaluate();
}

type FormulaDependencyGraph = {
  dependencies: Map<string, Set<string>>;
  dependents: Map<string, Set<string>>;
};

/**
 * Keeps derived formula results and dependency edges between workbook revisions.
 * Canonical workbook cells remain the only persisted source of graph data.
 */
export class FormulaCalculation {
  private workbook?: Workbook;
  private graph: FormulaDependencyGraph = { dependencies: new Map(), dependents: new Map() };
  private results = new Map<string, FormulaScalarValue>();
  private snapshot: FormulaEvaluationSnapshot = {};

  update(workbook: Workbook, onEvaluate?: FormulaEvaluationObserver): FormulaEvaluationSnapshot {
    const nextGraph = buildFormulaDependencyGraph(workbook);
    const formulaNodes = workbookFormulaNodes(workbook);
    let impacted: Set<string>;

    if (!this.workbook || workbookStructureChanged(this.workbook, workbook)) {
      impacted = new Set(formulaNodes);
    } else {
      const changedCells = changedWorkbookCells(this.workbook, workbook);
      impacted = dependentClosure(changedCells, this.graph.dependents, nextGraph.dependents);
    }

    if (this.workbook && impacted.size === 0) {
      this.workbook = workbook;
      this.graph = nextGraph;
      return this.snapshot;
    }

    const reusableResults = new Map(
      [...this.results].filter(([nodeId]) => formulaNodes.has(nodeId) && !impacted.has(nodeId)),
    );
    const evaluator = new FormulaEvaluator(workbook, reusableResults, onEvaluate);
    this.snapshot = evaluator.evaluate();
    this.results = evaluator.formulaResults();
    this.workbook = workbook;
    this.graph = nextGraph;
    return this.snapshot;
  }
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

export function formulaErrorValue(error: FormulaErrorCode): FormulaScalarValue {
  return { kind: 'error', error };
}

export function formulaScalarValue(value: FormulaValue): FormulaScalarValue {
  return value.kind === 'range' ? formulaErrorValue('#VALUE!') : value;
}

export function formulaCollectionValues(value: FormulaValue): Iterable<FormulaScalarValue> {
  return value.kind === 'range' ? value.values : [value];
}

export function classifyCellValue(raw: string): FormulaScalarValue {
  if (raw.length === 0) {
    return { kind: 'blank' };
  }

  const trimmed = raw.trim();
  const numeric = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(trimmed)
    ? Number(trimmed)
    : undefined;
  if (numeric !== undefined && Number.isFinite(numeric)) {
    return { kind: 'number', value: numeric };
  }
  if (/^TRUE$/i.test(trimmed)) {
    return { kind: 'boolean', value: true };
  }
  if (/^FALSE$/i.test(trimmed)) {
    return { kind: 'boolean', value: false };
  }
  return { kind: 'text', value: raw };
}

export function displayFormulaValue(value: FormulaScalarValue): FormulaDisplayResult {
  switch (value.kind) {
    case 'number':
      return {
        kind: 'number',
        value: value.value,
        display: Object.is(value.value, -0) ? '0' : String(value.value),
      };
    case 'text':
      return { ...value, display: value.value };
    case 'boolean':
      return { ...value, display: value.value ? 'TRUE' : 'FALSE' };
    case 'blank':
      return { kind: 'blank', display: '' };
    case 'error':
      return { ...value, display: value.error };
  }
}

function isComparisonOperator(
  operator: BinaryFormula['operator'],
): operator is '=' | '<>' | '<' | '<=' | '>' | '>=' {
  return operator === '='
    || operator === '<>'
    || operator === '<'
    || operator === '<='
    || operator === '>'
    || operator === '>=';
}

function compareFormulaScalars(
  left: FormulaScalarValue,
  right: FormulaScalarValue,
): -1 | 0 | 1 | undefined {
  if (left.kind === 'number' && right.kind === 'number') {
    return left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
  }
  if (left.kind === 'text' && right.kind === 'text') {
    return compareTextByCodePoint(left.value, right.value);
  }
  if (left.kind === 'boolean' && right.kind === 'boolean') {
    return left.value === right.value ? 0 : left.value ? 1 : -1;
  }
  if (left.kind === 'blank' && right.kind === 'blank') {
    return 0;
  }
  return undefined;
}

function compareTextByCodePoint(left: string, right: string): -1 | 0 | 1 {
  const leftCodePoints = [...left].map((value) => value.codePointAt(0) as number);
  const rightCodePoints = [...right].map((value) => value.codePointAt(0) as number);
  const sharedLength = Math.min(leftCodePoints.length, rightCodePoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftCodePoints[index] !== rightCodePoints[index]) {
      return leftCodePoints[index] < rightCodePoints[index] ? -1 : 1;
    }
  }
  return leftCodePoints.length < rightCodePoints.length
    ? -1
    : leftCodePoints.length > rightCodePoints.length
      ? 1
      : 0;
}

function applyComparisonOperator(
  comparison: -1 | 0 | 1,
  operator: '=' | '<>' | '<' | '<=' | '>' | '>=',
): boolean {
  switch (operator) {
    case '=':
      return comparison === 0;
    case '<>':
      return comparison !== 0;
    case '<':
      return comparison < 0;
    case '<=':
      return comparison <= 0;
    case '>':
      return comparison > 0;
    case '>=':
      return comparison >= 0;
  }
}

class FormulaEvaluator {
  private readonly results: Map<string, FormulaScalarValue>;
  private readonly visiting = new Set<string>();
  private readonly stack: { nodeId: string; sheet: Sheet; key: CellKey }[] = [];

  constructor(
    private readonly workbook: Workbook,
    initialResults: ReadonlyMap<string, FormulaScalarValue> = new Map(),
    private readonly onEvaluate?: FormulaEvaluationObserver,
  ) {
    this.results = new Map(initialResults);
  }

  formulaResults(): Map<string, FormulaScalarValue> {
    return new Map(this.results);
  }

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
          sheetResults[key] = displayFormulaValue(result);
        }
      }
      snapshot[sheet.id] = sheetResults;
    }

    return snapshot;
  }

  private evaluateFormulaCell(sheet: Sheet, key: CellKey): FormulaScalarValue {
    const nodeId = sheetCellNodeId(sheet.id, key);
    const cached = this.results.get(nodeId);
    if (cached) {
      return cached;
    }

    if (this.visiting.has(nodeId)) {
      const cycleStart = this.stack.findIndex((entry) => entry.nodeId === nodeId);
      for (const entry of this.stack.slice(cycleStart)) {
        this.results.set(entry.nodeId, formulaErrorValue('#CYCLE!'));
      }
      return formulaErrorValue('#CYCLE!');
    }

    const cell = sheet.cells[key];
    if (!cell?.startsWith('=')) {
      return this.evaluateLiteralCell(sheet, key);
    }

    this.onEvaluate?.(sheet.id, key);
    this.visiting.add(nodeId);
    this.stack.push({ nodeId, sheet, key });

    let result: FormulaScalarValue;
    const parsed = parseFormula(cell, this.workbook, sheet);
    if (parsed.kind === 'error') {
      result = formulaErrorValue(parsed.error);
    } else if (parsed.kind === 'formula') {
      result = formulaScalarValue(this.evaluateExpression(parsed.expression, sheet));
    } else {
      result = formulaErrorValue('#PARSE!');
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

  private evaluateExpression(expression: FormulaExpression, currentSheet: Sheet): FormulaValue {
    if (expression.kind === 'number') {
      return Number.isFinite(expression.value)
        ? { kind: 'number', value: expression.value }
        : formulaErrorValue('#VALUE!');
    }
    if (expression.kind === 'text') {
      return { kind: 'text', value: expression.value };
    }
    if (expression.kind === 'boolean') {
      return { kind: 'boolean', value: expression.value };
    }
    if (expression.kind === 'group') {
      return this.evaluateExpression(expression.expression, currentSheet);
    }
    if (expression.kind === 'unary') {
      return this.evaluateUnary(expression, currentSheet);
    }
    if (expression.kind === 'binary') {
      return this.evaluateBinary(expression, currentSheet);
    }
    if (expression.kind === 'function') {
      return expression.functionName === 'SUM'
        ? this.evaluateSum(expression, currentSheet)
        : this.evaluateCommonFunction(expression, currentSheet);
    }
    return this.evaluateReference(expression, currentSheet);
  }

  private evaluateUnary(expression: UnaryFormula, currentSheet: Sheet): FormulaScalarValue {
    const operand = formulaScalarValue(this.evaluateExpression(expression.operand, currentSheet));
    if (operand.kind === 'error') {
      return operand;
    }
    if (operand.kind !== 'number') {
      return formulaErrorValue('#VALUE!');
    }

    const value = expression.operator === '-' ? -operand.value : operand.value;
    return Number.isFinite(value)
      ? { kind: 'number', value }
      : formulaErrorValue('#VALUE!');
  }

  private evaluateBinary(expression: BinaryFormula, currentSheet: Sheet): FormulaScalarValue {
    const left = formulaScalarValue(this.evaluateExpression(expression.left, currentSheet));
    if (left.kind === 'error') {
      return left;
    }

    const right = formulaScalarValue(this.evaluateExpression(expression.right, currentSheet));
    if (right.kind === 'error') {
      return right;
    }

    if (isComparisonOperator(expression.operator)) {
      if (left.kind !== right.kind) {
        return formulaErrorValue('#VALUE!');
      }

      const comparison = compareFormulaScalars(left, right);
      return comparison === undefined
        ? formulaErrorValue('#VALUE!')
        : { kind: 'boolean', value: applyComparisonOperator(comparison, expression.operator) };
    }

    if (left.kind !== 'number' || right.kind !== 'number') {
      return formulaErrorValue('#VALUE!');
    }
    if (expression.operator === '/' && right.value === 0) {
      return formulaErrorValue('#DIV/0!');
    }

    const value =
      expression.operator === '+'
        ? left.value + right.value
        : expression.operator === '-'
          ? left.value - right.value
          : expression.operator === '*'
            ? left.value * right.value
            : left.value / right.value;
    return Number.isFinite(value)
      ? { kind: 'number', value }
      : formulaErrorValue('#VALUE!');
  }

  private evaluateSum(expression: FunctionFormula, currentSheet: Sheet): FormulaScalarValue {
    const numbers = this.evaluateNumericCollections(expression.arguments, currentSheet);
    if (numbers.kind === 'error') {
      return numbers;
    }

    const total = numbers.values.reduce((sum, value) => sum + value, 0);
    return Number.isFinite(total)
      ? { kind: 'number', value: total }
      : formulaErrorValue('#VALUE!');
  }

  private evaluateCommonFunction(
    expression: FunctionFormula,
    currentSheet: Sheet,
  ): FormulaScalarValue {
    switch (expression.functionName) {
      case 'AVERAGE':
      case 'MIN':
      case 'MAX':
      case 'COUNT':
      case 'COUNTA':
        if (expression.arguments.length === 0) {
          return formulaErrorValue('#VALUE!');
        }
        return this.evaluateAggregateFunction(expression, currentSheet);
      case 'ABS':
      case 'SQRT':
        if (expression.arguments.length !== 1) {
          return formulaErrorValue('#VALUE!');
        }
        return this.evaluateNumericScalarFunction(expression, currentSheet);
      default:
        return formulaErrorValue('#NAME!');
    }
  }

  private evaluateAggregateFunction(
    expression: FunctionFormula,
    currentSheet: Sheet,
  ): FormulaScalarValue {
    if (expression.functionName === 'COUNTA') {
      let count = 0;
      for (const argument of expression.arguments) {
        const argumentValue = this.evaluateExpression(argument, currentSheet);
        for (const value of formulaCollectionValues(argumentValue)) {
          if (value.kind === 'error') {
            return value;
          }
          if (value.kind !== 'blank') {
            count += 1;
          }
        }
      }
      return { kind: 'number', value: count };
    }

    const numbers = this.evaluateNumericCollections(expression.arguments, currentSheet);
    if (numbers.kind === 'error') {
      return numbers;
    }

    switch (expression.functionName) {
      case 'AVERAGE': {
        if (numbers.values.length === 0) {
          return formulaErrorValue('#DIV/0!');
        }
        const total = numbers.values.reduce((sum, value) => sum + value, 0);
        const average = total / numbers.values.length;
        return Number.isFinite(average)
          ? { kind: 'number', value: average }
          : formulaErrorValue('#VALUE!');
      }
      case 'MIN':
        return numbers.values.length > 0
          ? { kind: 'number', value: numbers.values.reduce((minimum, value) => Math.min(minimum, value)) }
          : formulaErrorValue('#VALUE!');
      case 'MAX':
        return numbers.values.length > 0
          ? { kind: 'number', value: numbers.values.reduce((maximum, value) => Math.max(maximum, value)) }
          : formulaErrorValue('#VALUE!');
      case 'COUNT':
        return { kind: 'number', value: numbers.values.length };
      default:
        return formulaErrorValue('#VALUE!');
    }
  }

  private evaluateNumericScalarFunction(
    expression: FunctionFormula,
    currentSheet: Sheet,
  ): FormulaScalarValue {
    const value = formulaScalarValue(this.evaluateExpression(expression.arguments[0], currentSheet));
    if (value.kind === 'error') {
      return value;
    }
    if (value.kind !== 'number') {
      return formulaErrorValue('#VALUE!');
    }

    const result = expression.functionName === 'ABS'
      ? Math.abs(value.value)
      : value.value < 0
        ? undefined
        : Math.sqrt(value.value);

    return result !== undefined && Number.isFinite(result)
      ? { kind: 'number', value: result }
      : formulaErrorValue('#VALUE!');
  }

  private evaluateNumericCollections(
    args: readonly FormulaExpression[],
    currentSheet: Sheet,
  ): { kind: 'numbers'; values: number[] } | { kind: 'error'; error: FormulaErrorCode } {
    const values: number[] = [];
    for (const argument of args) {
      const argumentValue = this.evaluateExpression(argument, currentSheet);
      for (const value of formulaCollectionValues(argumentValue)) {
        if (value.kind === 'error') {
          return value;
        }
        if (value.kind === 'number') {
          values.push(value.value);
        }
      }
    }

    return { kind: 'numbers', values };
  }

  private evaluateReference(
    reference: FormulaReference,
    currentSheet: Sheet,
  ): FormulaValue {
    const sheet = resolveFormulaReferenceSheet(reference, this.workbook, currentSheet);
    if (!sheet.ok) {
      return formulaErrorValue('#REF!');
    }

    if (reference.kind === 'cell') {
      if (!isAddressWithinBounds(reference.address, sheet.value)) {
        return formulaErrorValue('#REF!');
      }
      return this.evaluateReferencedCell(sheet.value, cellKey(reference.address));
    }

    const range = expandRange(reference.range, sheet.value);
    if (!range.ok) {
      return formulaErrorValue('#REF!');
    }

    return {
      kind: 'range',
      values: this.evaluateRangeCells(sheet.value, range.value),
      rowCount: reference.range.end.rowIndex - reference.range.start.rowIndex + 1,
      columnCount: reference.range.end.columnIndex - reference.range.start.columnIndex + 1,
    };
  }

  private *evaluateRangeCells(
    sheet: Sheet,
    addresses: readonly CellAddress[],
  ): IterableIterator<FormulaScalarValue> {
    for (const address of addresses) {
      yield this.evaluateReferencedCell(sheet, cellKey(address));
    }
  }

  private evaluateReferencedCell(sheet: Sheet, key: CellKey): FormulaScalarValue {
    const cell = sheet.cells[key];
    if (cell === undefined) {
      return { kind: 'blank' };
    }

    if (cell.startsWith('=')) {
      return this.evaluateFormulaCell(sheet, key);
    }

    return classifyCellValue(cell);
  }

  private evaluateLiteralCell(sheet: Sheet, key: CellKey): FormulaScalarValue {
    return classifyCellValue(sheet.cells[key] ?? '');
  }
}

function workbookFormulaNodes(workbook: Workbook): Set<string> {
  const nodes = new Set<string>();
  for (const sheet of workbook.sheets) {
    for (const [key, raw] of Object.entries(sheet.cells)) {
      if (raw.startsWith('=')) {
        nodes.add(sheetCellNodeId(sheet.id, key));
      }
    }
  }
  return nodes;
}

function buildFormulaDependencyGraph(workbook: Workbook): FormulaDependencyGraph {
  const graph: FormulaDependencyGraph = {
    dependencies: new Map(),
    dependents: new Map(),
  };

  for (const sheet of workbook.sheets) {
    for (const [key, raw] of Object.entries(sheet.cells)) {
      if (!raw.startsWith('=')) {
        continue;
      }
      const formulaNode = sheetCellNodeId(sheet.id, key);
      const parsed = parseFormula(raw, workbook, sheet);
      const dependencies = parsed.kind === 'formula'
        ? expressionDependencies(parsed.expression, workbook, sheet)
        : new Set<string>();
      graph.dependencies.set(formulaNode, dependencies);
      for (const dependency of dependencies) {
        const dependents = graph.dependents.get(dependency) ?? new Set<string>();
        dependents.add(formulaNode);
        graph.dependents.set(dependency, dependents);
      }
    }
  }

  return graph;
}

function expressionDependencies(
  expression: FormulaExpression,
  workbook: Workbook,
  currentSheet: Sheet,
): Set<string> {
  if (expression.kind === 'number' || expression.kind === 'text' || expression.kind === 'boolean') {
    return new Set();
  }
  if (expression.kind === 'group') {
    return expressionDependencies(expression.expression, workbook, currentSheet);
  }
  if (expression.kind === 'unary') {
    return expressionDependencies(expression.operand, workbook, currentSheet);
  }
  if (expression.kind === 'binary') {
    return new Set([
      ...expressionDependencies(expression.left, workbook, currentSheet),
      ...expressionDependencies(expression.right, workbook, currentSheet),
    ]);
  }
  if (expression.kind === 'function') {
    const dependencies = new Set<string>();
    for (const argument of expression.arguments) {
      for (const dependency of expressionDependencies(argument, workbook, currentSheet)) {
        dependencies.add(dependency);
      }
    }
    return dependencies;
  }

  const targetSheet = resolveFormulaReferenceSheet(expression, workbook, currentSheet);
  if (!targetSheet.ok) {
    return new Set();
  }
  if (expression.kind === 'cell') {
    return new Set([sheetCellNodeId(targetSheet.value.id, cellKey(expression.address))]);
  }

  const addresses = expandRange(expression.range, targetSheet.value);
  return addresses.ok
    ? new Set(addresses.value.map((address) => sheetCellNodeId(targetSheet.value.id, cellKey(address))))
    : new Set();
}

function workbookStructureChanged(previous: Workbook, next: Workbook): boolean {
  if (previous.sheets.length !== next.sheets.length) {
    return true;
  }
  const previousSheets = new Map(previous.sheets.map((sheet) => [sheet.id, sheet]));
  return next.sheets.some((sheet) => {
    const previousSheet = previousSheets.get(sheet.id);
    return (
      !previousSheet
      || previousSheet.columnCount !== sheet.columnCount
      || previousSheet.rowCount !== sheet.rowCount
    );
  });
}

function changedWorkbookCells(previous: Workbook, next: Workbook): Set<string> {
  const changed = new Set<string>();
  const previousSheets = new Map(previous.sheets.map((sheet) => [sheet.id, sheet]));
  for (const sheet of next.sheets) {
    const previousSheet = previousSheets.get(sheet.id);
    const keys = new Set([
      ...Object.keys(previousSheet?.cells ?? {}),
      ...Object.keys(sheet.cells),
    ]);
    for (const key of keys) {
      if (previousSheet?.cells[key] !== sheet.cells[key]) {
        changed.add(sheetCellNodeId(sheet.id, key));
      }
    }
  }
  return changed;
}

function dependentClosure(
  changedCells: ReadonlySet<string>,
  previousDependents: ReadonlyMap<string, Set<string>>,
  nextDependents: ReadonlyMap<string, Set<string>>,
): Set<string> {
  const impacted = new Set(changedCells);
  const pending = [...changedCells];
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    const dependents = new Set([
      ...(previousDependents.get(nodeId) ?? []),
      ...(nextDependents.get(nodeId) ?? []),
    ]);
    for (const dependent of dependents) {
      if (!impacted.has(dependent)) {
        impacted.add(dependent);
        pending.push(dependent);
      }
    }
  }
  return impacted;
}

export function formulaRawForStorage(raw: string, workbook: Workbook): string {
  return replaceFormulaQualifiers(raw, (sheetReference) => {
    if (sheetReference === '#REF') {
      return sheetReference;
    }
    return workbook.sheets.find(
      (candidate) => candidate.name === sheetReference || candidate.id === sheetReference,
    )?.id ?? '#REF';
  });
}

export function formulaRawForDisplay(raw: string, workbook: Workbook): string {
  return replaceFormulaQualifiers(raw, (sheetId) => {
    const sheet = workbook.sheets.find((candidate) => candidate.id === sheetId);
    return sheet ? formatSheetReferenceToken(sheet.name) : '#REF';
  });
}

export function formulaSheetReferenceIds(raw: string): string[] {
  return formulaSheetReferences(raw).filter((sheetId) => sheetId !== '#REF');
}

export function remapFormulaSheetIds(raw: string, remaps: ReadonlyMap<string, string>): string {
  return replaceFormulaQualifiers(raw, (sheetId) => remaps.get(sheetId) ?? sheetId);
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
